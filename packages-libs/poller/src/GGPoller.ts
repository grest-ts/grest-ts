import {PollerHandler, PollerState} from "./types";
import {GGLock} from "@grest-ts/lock";
import {GGPollerMetrics} from "./GGPollerMetrics";
import {GGLocator, GGLocatorScope} from "@grest-ts/locator";
import {GGPollerConfig, GGPollerConfigData} from "./GGPollerConfig";

/** Resolved settings with all required fields */
interface ResolvedSettings {
    lockTtlMs: number;
    heartbeatIntervalMs: number;
    pollIntervalMs: number;
    batchSize: number;
    concurrency: number;
    retryAcquireIntervalMs: number;
    instanceId?: string;
}

/**
 * Poll-based job executor with leader election.
 */
export class GGPoller<T> {
    private readonly lock: GGLock;
    private readonly handler: PollerHandler<T>;
    private readonly lockName: string;

    // Cached settings - updated at poll cycle boundaries
    private settings: ResolvedSettings;
    private nextSettings: ResolvedSettings | null = null;

    private state: PollerState = 'stopped';
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private pollTimer: ReturnType<typeof setTimeout> | null = null;
    private stopPromise: Promise<void> | null = null;
    private stopResolve: (() => void) | null = null;
    private inFlightCount = 0;
    private processingPromise: Promise<void> | null = null;
    private scope: GGLocatorScope | null = null;
    private leaderSince: number | null = null;

    constructor(
        config: GGPollerConfig,
        lock: GGLock,
        handler: PollerHandler<T>
    ) {
        this.lock = lock;
        this.handler = handler;
        this.lockName = config.lockName;

        this.settings = this.resolveSettings(config.settings.get());
        config.settings.watch((data) => {
            this.nextSettings = this.resolveSettings(data);
        });

        if (this.settings.heartbeatIntervalMs >= this.settings.lockTtlMs) {
            throw new Error(`heartbeatIntervalMs (${this.settings.heartbeatIntervalMs}) must be less than lockTtlMs (${this.settings.lockTtlMs})`);
        }
        if (this.settings.concurrency < 1) {
            throw new Error(`concurrency must be at least 1`);
        }
    }

    private resolveSettings(data: GGPollerConfigData): ResolvedSettings {
        return {
            lockTtlMs: data.lockTtlMs!,
            heartbeatIntervalMs: data.heartbeatIntervalMs!,
            pollIntervalMs: data.pollIntervalMs!,
            batchSize: data.batchSize!,
            concurrency: data.concurrency!,
            retryAcquireIntervalMs: data.retryAcquireIntervalMs!,
            instanceId: data.instanceId,
        };
    }

    getState(): PollerState {
        return this.state;
    }

    isLeader(): boolean {
        return this.state === 'leader';
    }

    async start(): Promise<void> {
        if (this.state !== 'stopped') {
            throw new Error(`Cannot start poller in state: ${this.state}`);
        }

        this.scope = GGLocator.getScope();
        this.state = 'waiting';
        this.tryAcquireLock();
    }

    async stop(): Promise<void> {
        if (this.state === 'stopped') return;
        if (this.state === 'stopping') return this.stopPromise ?? Promise.resolve();

        this.state = 'stopping';
        this.stopPromise = new Promise(resolve => {
            this.stopResolve = resolve;
        });

        this.clearTimers();

        if (this.processingPromise) {
            await this.processingPromise;
        }

        if (this.leaderSince !== null) {
            try {
                await this.lock.release(this.lockName);
            } catch {
            }
            this.recordLeadershipEnd();
        }

        this.state = 'stopped';
        this.stopResolve?.();
    }

    private clearTimers(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    private recordLeadershipEnd(): void {
        if (this.leaderSince === null) return;
        try {
            GGPollerMetrics.leadership.totalHoldTime.inc(Date.now() - this.leaderSince, {poller: this.lockName});
            GGPollerMetrics.leadership.isLeader.set(0, {poller: this.lockName});
        } catch {
        }
        this.leaderSince = null;
    }

    private async tryAcquireLock(): Promise<void> {
        if (this.state !== 'waiting') return;

        let acquired = false;
        try {
            acquired = await this.lock.acquire(this.lockName, this.settings.lockTtlMs);
        } catch {
        }

        if (!acquired) {
            if (this.state === 'waiting') {
                this.pollTimer = this.scope!.setTimeout(() => this.tryAcquireLock(), this.settings.retryAcquireIntervalMs);
            }
            return;
        }

        // Became leader
        this.state = 'leader';
        this.leaderSince = Date.now();
        try {
            GGPollerMetrics.leadership.isLeader.set(1, {poller: this.lockName});
        } catch {
        }

        // Start heartbeat
        this.heartbeatTimer = this.scope!.setInterval(async () => {
            if (this.state !== 'leader') return;

            let renewed = false;
            try {
                renewed = await this.lock.renew(this.lockName, this.settings.lockTtlMs);
            } catch {
            }

            if (!renewed && this.state === 'leader') {
                this.clearTimers();
                this.recordLeadershipEnd();
                this.state = 'waiting';
                this.pollTimer = this.scope!.setTimeout(() => this.tryAcquireLock(), this.settings.retryAcquireIntervalMs);
            }
        }, this.settings.heartbeatIntervalMs);

        this.schedulePoll();
    }

    private schedulePoll(): void {
        if (this.state !== 'leader') return;
        this.pollTimer = this.scope!.setTimeout(() => this.poll(), this.settings.pollIntervalMs);
    }

    private async poll(): Promise<void> {
        if (this.state !== 'leader') return;

        // Apply pending config updates at cycle boundary
        if (this.nextSettings) {
            this.settings = this.nextSettings;
            this.nextSettings = null;
        }

        const labels = {poller: this.lockName};
        const availableSlots = this.settings.concurrency - this.inFlightCount;

        if (availableSlots <= 0) {
            this.schedulePoll();
            return;
        }

        const limit = Math.min(availableSlots, this.settings.batchSize);
        const pollStart = Date.now();

        let items: T[] = [];
        try {
            items = await this.handler.getData(limit);
            try {
                GGPollerMetrics.polling.polls.inc(1, labels);
                GGPollerMetrics.polling.duration.inc(Date.now() - pollStart, labels);
            } catch {
            }
        } catch {
            this.schedulePoll();
            return;
        }

        if (items.length === 0) {
            try {
                GGPollerMetrics.polling.emptyPolls.inc(1, labels);
            } catch {
            }
            this.handler.onCompleted({processed: 0, failed: 0, durationMs: 0, empty: true});
            this.schedulePoll();
            return;
        }

        // Process batch with concurrency limit
        const batchStart = Date.now();
        this.processingPromise = (async () => {
            let processed = 0;
            let failed = 0;
            let index = 0;

            const processItem = async (item: T): Promise<boolean> => {
                if (this.state !== 'leader') return false;

                this.inFlightCount++;
                try {
                    GGPollerMetrics.jobs.inFlight.inc(1, labels);
                } catch {
                }

                const itemStart = Date.now();
                let success = false;
                try {
                    await this.handler.run(item);
                    success = true;
                } catch {
                }

                this.inFlightCount--;
                try {
                    GGPollerMetrics.jobs.inFlight.dec(1, labels);
                    GGPollerMetrics.jobs.duration.inc(Date.now() - itemStart, labels);
                    GGPollerMetrics.jobs.processed.inc(1, {...labels, result: success ? 'OK' : 'ERROR'});
                } catch {
                }

                return success;
            };

            // Worker pool pattern: N workers pull from shared index
            const worker = async () => {
                while (true) {
                    const i = index++;
                    if (i >= items.length) break;
                    const success = await processItem(items[i]);
                    if (success) processed++;
                    else failed++;
                }
            };

            // Start `concurrency` workers
            const workers = Array.from(
                {length: Math.min(this.settings.concurrency, items.length)},
                () => worker()
            );
            await Promise.all(workers);

            try {
                GGPollerMetrics.duration.inc(Date.now() - pollStart, labels);
            } catch {
            }
            this.handler.onCompleted({processed, failed, durationMs: Date.now() - batchStart, empty: false});
        })();

        this.schedulePoll();
    }
}
