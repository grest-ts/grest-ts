import {GGLog} from "@grest-ts/logger";
import {withTimeout} from "@grest-ts/common";
import {GGContext} from "@grest-ts/context";
import {GG_TRACE} from "@grest-ts/trace";
import {IPCClientRequest} from "@grest-ts/ipc";
import type {RuntimeRunner} from "./runner/RuntimeRunner";
import {InlineRunner} from "./runner/InlineRunner";
import {WorkerRunner} from "./runner/WorkerRunner";
import {IsolatedRunner} from "./runner/IsolatedRunner";
import type {GGTestRunner} from "./GGTestRunner";

/**
 * Lifecycle state of a runtime instance.
 */
export enum GGTestRuntimeState {
    /** Initial state, not yet started */
    CREATED = 'created',
    /** Running successfully */
    STARTED = 'started',
    /** Startup failed, but worker/IPC still alive for diagnostics */
    FAILED = 'failed',
    /** Runtime stopped, but worker/IPC still alive for log retrieval */
    STOPPED = 'stopped',
    /** Fully shut down, no IPC available */
    SHUTDOWN = 'shutdown',
}

export interface GGTestEnvConfig {
    executablePath: string;
    className: string;
    testRouterPort: number;
    testId: string;
    runtimeId: string;
    initialCommands: GGTestCommand[];
    /** When true, the runtime runs inline (same process). Affects module loading strategy. */
    inline?: boolean;
}

export interface GGTestCommand<Payload = unknown> {
    method: string;
    payload: Payload;
}

export interface GGTestRuntimeConfig {
    mode?: GGTestMode
}

export enum GGTestMode {
    INLINE = 'INLINE',
    WORKER = 'WORKER',
    ISOLATED = 'ISOLATED'
}

export class GGTestRuntime {

    public readonly runner: GGTestRunner;

    /**
     * Unique identifier for this runtime instance.
     * Used for targeted communication (e.g., "checklist-0", "checklist-1").
     */
    public readonly runtimeId: string

    /**
     * The runtime name used for selector access (e.g., "checklist").
     * This is the static NAME property from the runtime class.
     */
    public readonly name: string

    /**
     * The class name of the runtime (e.g., "ChecklistRuntime").
     * Used for file matching and logging.
     */
    public readonly className: string

    /**
     * Lifecycle state of this runtime instance.
     */
    private _state: GGTestRuntimeState = GGTestRuntimeState.CREATED

    public get state(): GGTestRuntimeState {
        return this._state;
    }

    /**
     * Locator keys registered by this runtime.
     * Populated via IPC after compose completes.
     */
    private readonly registeredLocatorKeys: Set<string> = new Set()

    /**
     * Commands to be sent to this runtime on startup.
     * Queued before start(), passed to worker via env.
     */
    private readonly initialCommands: GGTestCommand[] = []

    private readonly executablePath: string;
    private readonly config: GGTestRuntimeConfig;
    private runtimeRunner?: RuntimeRunner
    /** Factory to create the runtime without dynamic import (used by inline mode) */
    public runtimeFactory?: () => any;

    /** Counter for generating unique runtime IDs per name */
    private static runtimeCounters: Map<string, number> = new Map();

    public constructor(runner: GGTestRunner, executablePath: string, className: string, name: string, config?: GGTestRuntimeConfig) {
        this.executablePath = executablePath;
        this.className = className;
        this.name = name;
        this.runtimeId = GGTestRuntime.generateRuntimeId(name);
        this.config = config ?? {}
        this.config.mode ??= GGTestMode.WORKER
        this.runner = runner
        this.runner.addRuntime(this);
    }

    private static generateRuntimeId(name: string): string {
        const count = GGTestRuntime.runtimeCounters.get(name) ?? 0;
        GGTestRuntime.runtimeCounters.set(name, count + 1);
        return `${name}-${count}`;
    }

    public async start(): Promise<this> {
        if (this._state !== GGTestRuntimeState.CREATED) {
            throw new Error("Can only start runtimes if they are in CREATED state! Current state: " + this._state);
        }
        await new GGContext("Test").run(async () => {
            GG_TRACE.init();
            GGLog.debug(this, 'Launching ' + this.className + ' in ' + this.config.mode + ' mode...')

            const config: GGTestEnvConfig = {
                executablePath: this.executablePath,
                className: this.className,
                testRouterPort: this.runner.ipcServer.getPort(),
                testId: this.runner.testId,
                runtimeId: this.runtimeId,
                initialCommands: this.initialCommands
            }
            switch (this.config.mode) {
                case GGTestMode.INLINE:
                    config.inline = true;
                    this.runtimeRunner = new InlineRunner(config, this.runtimeFactory);
                    break;
                case GGTestMode.WORKER:
                    this.runtimeRunner = new WorkerRunner(config);
                    break;
                case GGTestMode.ISOLATED:
                    this.runtimeRunner = new IsolatedRunner(config);
                    break;
                default:
                    throw new Error(`Unknown test mode: ${this.config.mode}`);
            }

            const startupTimeout = 30000;
            try {
                await withTimeout(
                    this.runtimeRunner.start(),
                    startupTimeout,
                    'Service ' + this.className + ' failed to start within ' + startupTimeout + 'ms'
                );
                this._state = GGTestRuntimeState.STARTED;
                GGLog.debug(this, this.className + ' started successfully')
            } catch (error) {
                // Mark as failed but keep runner alive for diagnostics (e.g., log retrieval)
                this._state = GGTestRuntimeState.FAILED;
                throw error;
            }
        });
        return this
    }

    /**
     * Stop the GGRuntime (teardown services) but keep worker/IPC alive.
     * This allows log retrieval after the runtime has stopped.
     * Idempotent - safe to call multiple times.
     */
    public async stop(): Promise<void> {
        await new GGContext("Test").run(async () => {
            GG_TRACE.init();
            if (this._state === GGTestRuntimeState.STOPPED || this._state === GGTestRuntimeState.SHUTDOWN) {
                // Already stopped or shutdown, nothing to do
                return;
            }
            if (this._state === GGTestRuntimeState.FAILED) {
                // Already failed, just mark as stopped
                this._state = GGTestRuntimeState.STOPPED;
                return;
            }
            if (this._state === GGTestRuntimeState.CREATED) {
                // Never started (e.g., another runtime or hook failed first), nothing to stop
                this._state = GGTestRuntimeState.STOPPED;
                return;
            }
            if (this._state !== GGTestRuntimeState.STARTED) {
                throw new Error("Can only stop runtimes in STARTED state! Current state: " + this._state);
            }
            GGLog.debug(this, 'Stopping ' + this.className + '...')
            try {
                await this.runtimeRunner?.stopRuntime()
            } catch (error) {
                GGLog.error(this, 'Error stopping ' + this.className, error)
            }
            this._state = GGTestRuntimeState.STOPPED;
            GGLog.debug(this, this.className + ' stopped')
        });
    }

    /**
     * Fully shutdown the runtime and worker. IPC will be disconnected.
     * After this, no commands can be sent.
     */
    public async shutdown(): Promise<void> {
        await new GGContext("Test").run(async () => {
            GG_TRACE.init();
            if (this._state === GGTestRuntimeState.SHUTDOWN) {
                return; // Already shutdown
            }
            GGLog.debug(this, 'Shutting down ' + this.className + '...')
            try {
                await this.runtimeRunner?.shutdown()
            } catch (error) {
                GGLog.error(this, 'Error shutting down ' + this.className, error)
            }
            this.runtimeRunner = undefined
            this._state = GGTestRuntimeState.SHUTDOWN;
            GGLog.debug(this, this.className + ' shut down')
        });
    }

    public async sendCommand<Payload, Result>(type: IPCClientRequest<Payload, Result>, payload: Payload): Promise<Result> {
        switch (this._state) {
            case GGTestRuntimeState.CREATED:
                this.initialCommands.push({method: type, payload: payload});
                return undefined as Result;
            case GGTestRuntimeState.STARTED:
            case GGTestRuntimeState.FAILED:
            case GGTestRuntimeState.STOPPED:
                // IPC still available in these states
                return await this.runner.ipcServer.sendFrameworkMessage(this.runtimeId, type, payload);
            case GGTestRuntimeState.SHUTDOWN:
                throw new Error(`Cannot send command to shut down runtime ${this.className}`);
        }
    }

    // -----------
    // Key registration (for callOn routing)
    // -----------

    /**
     * Register multiple locator keys at once.
     */
    public registerLocatorKeys(keys: string[]): void {
        for (const key of keys) {
            this.registeredLocatorKeys.add(key);
        }
    }

    /**
     * Check if this runtime has a specific locator key.
     */
    public hasLocatorKey(key: string): boolean {
        return this.registeredLocatorKeys.has(key);
    }

}
