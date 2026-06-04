import {withTimeout, enumOf, type Values} from "@grest-ts/common";
import {GGLog} from "@grest-ts/logger";
import {GGLocator, GGLocatorLifecycleCallbacks, GGLocatorScope} from "@grest-ts/locator";
import {GGContext} from "@grest-ts/context";
import {GG_TRACE} from "@grest-ts/trace";
import {GG_DISCOVERY} from "@grest-ts/discovery";

export interface GGRuntimeConfig {
    shutdownTimeoutMs?: number;
}

export const GGRuntimeState = enumOf({
    CREATED: 0,
    BOOTSTRAPPING: 1,
    COMPOSING: 2,
    STARTING: 3,
    RUNNING: 4,
    STOPPING: 5,
    STOPPED: 6,
});
export type GGRuntimeState = Values<typeof GGRuntimeState>;

export abstract class GGRuntime {

    declare public static readonly NAME: string;

    public static SOURCE_MODULE_URL?: string;

    public readonly name: string;
    public readonly scope: GGLocatorScope;

    private readonly runtimeConfig: Required<GGRuntimeConfig>;
    private readonly services: GGLocatorLifecycleCallbacks[][] = [];
    private state: GGRuntimeState = GGRuntimeState.CREATED

    public constructor() {
        this.name = (this.constructor as any).NAME;
        if (!this.name) {
            throw new Error(`"${this.constructor.name}" must define static NAME property!\n
            Just add 'public static readonly NAME = "MyRuntime";' to your class definition.`)
        }

        this.runtimeConfig = {
            shutdownTimeoutMs: 10000,
        };
        const scopeName = this.constructor.name + "[" + this.name + "]";
        if (GGLocator.hasScope()) {
            // This most likely means we are running in the test worker. It has already configured a few things.
            this.scope = GGLocator.getScope().branch(scopeName, this.name);
        } else {
            // Standalone running, we need to fully configure everything.
            this.scope = new GGLocatorScope(scopeName, undefined, this.name);
            GGLog.init(this.scope)
        }
    }

    /**
     * CLI entry point for runtime files.
     *
     * Call this at the end of your runtime file:
     * ```typescript
     * class MyRuntime extends GGRuntime { ... }
     * MyRuntime.cli(import.meta.url);
     * ```
     *
     * When the file is run directly (not imported), this starts the runtime.
     */
    public static async cli<T extends GGRuntime>(
        this: new() => T,
        moduleUrl: string,
    ): Promise<void> {
        (this as unknown as typeof GGRuntime).SOURCE_MODULE_URL = moduleUrl;

        const modulePath = moduleUrl.replace('file:///', '').replace(/\//g, '\\');
        const argPath = process.argv[1]?.replace(/\//g, '\\');

        const isMain = argPath && (
            modulePath === argPath ||
            modulePath.endsWith(argPath) ||
            argPath.endsWith(modulePath.split('\\').pop() || '')
        );

        if (isMain) {
            await new this().start()
        }
    }

    protected abstract compose(): void | Promise<void>;

    public async start(): Promise<this> {
        await this.scope.run(async () => {
            if (this.state !== GGRuntimeState.CREATED) {
                throw new Error("Runtime already started!");
            }
            this.state = GGRuntimeState.BOOTSTRAPPING;
            await new GGContext("Runtime").run(async () => {
                GG_TRACE.init();
                // GGLog.info(this, "Runtime starting");
                try {
                    process.on('SIGTERM', () => this.teardown(true));
                    process.on('SIGINT', () => this.teardown(true));
                    this.state = GGRuntimeState.COMPOSING;
                    // GGLog.info(this, "Composing services...");

                    // Enable service registration during compose
                    this.scope.setLifecycleOwner((lifecycle) => {
                        if (!this.services[lifecycle.type]) {
                            this.services[lifecycle.type] = [];
                        }
                        this.services[lifecycle.type].push(lifecycle);
                    });

                    await this.compose();

                    // Set up service discovery for test/local etc. (if service has not setup its own discovery)
                    if (process.env.NODE_ENV !== "production" && !GG_DISCOVERY.has()) {
                        // Inline import, we don't want these to get into production. (built version).
                        const {GG_LOCAL_ROUTER_PORT, GGLocalDiscoveryClient, GGLocalDiscoveryResilientClient} = await import("@grest-ts/discovery-local");
                        if (process.env[GG_LOCAL_ROUTER_PORT]) {
                            new GGLocalDiscoveryClient(Number(process.env[GG_LOCAL_ROUTER_PORT]));
                        } else {
                            new GGLocalDiscoveryResilientClient();
                        }
                    }

                    // Disable registration - any later calls will throw
                    this.scope.setLifecycleOwner(undefined);
                    Object.freeze(this.services);
                    for (let i = 0; i < this.services.length; i++) {
                        if (this.services[i]) Object.freeze(this.services[i]);
                    }

                    GGLog.info(this, "Starting...");
                    this.state = GGRuntimeState.STARTING;
                    await this.callStartHandlers();
                    this.state = GGRuntimeState.RUNNING;
                    GGLog.info(this, "Runtime running");
                } catch (err) {
                    this.scope.setLifecycleOwner(undefined);
                    GGLog.error(this, err instanceof Error ? err : new Error(String(err)));
                    await this.callTeardownCallbacks();
                    this.state = GGRuntimeState.STOPPED;
                    throw err;
                }
            });
        })
        return this;
    }

    private async callStartHandlers(): Promise<void> {
        const startedServices: GGLocatorLifecycleCallbacks[] = [];
        try {
            for (let i = 0; i < this.services.length; i++) {
                if (!this.services[i]) continue;
                const startPromises = this.services[i].map(async (service) => {
                    try {
                        GGLog.info(this, "Starting service P" + service.type);
                        await service.start();
                        startedServices.push(service);
                    } catch (error) {
                        throw error;
                    }
                });

                const results = await Promise.allSettled(startPromises);
                const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
                if (failed.length > 0) {
                    throw failed[0].reason;
                }
            }
        } catch (error) {
            GGLog.error(this, "Service startup failed, cleaning up already-started services...");
            for (let i = startedServices.length - 1; i >= 0; i--) {
                try {
                    GGLog.info(this, "Cleaning up service");
                    await startedServices[i]?.teardown?.();
                } catch (error) {
                    GGLog.error(this, "Failed to cleanup", error);
                }
            }
            throw error;
        }
    }

    public async teardown(exit: boolean = false) {
        await this.scope.run(async () => {
            if (this.state === GGRuntimeState.STOPPING || this.state === GGRuntimeState.STOPPED) {
                GGLog.warn(this, "Shutdown already in progress");
                return;
            }
            await new GGContext("Runtime").run(async () => {
                GG_TRACE.init();
                this.state = GGRuntimeState.STOPPING;
                GGLog.info(this, "Gracefully shutting down");
                await withTimeout(this.callTeardownCallbacks(), this.runtimeConfig.shutdownTimeoutMs, `Shutdown timeout after ${this.runtimeConfig.shutdownTimeoutMs}ms, forcing exit`)
                GGLog.info(this, "Shutdown complete");
                this.state = GGRuntimeState.STOPPED;
                if (exit === true) {
                    process.exit(0);
                }
            });
        });
    }

    private async callTeardownCallbacks(): Promise<void> {
        for (let i = this.services.length - 1; i >= 0; i--) {
            if (!this.services[i]) continue;
            const teardownPromises = this.services[i].map(async (service) => {
                GGLog.info(this, "Tearing down service P" + service.type);
                if (!service.teardown) return;
                try {
                    await service.teardown();
                } catch (error) {
                    GGLog.error(this, error as Error);
                }
            });
            await Promise.allSettled(teardownPromises);
        }
    }
}
