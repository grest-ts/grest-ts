import {GGTestRuntime} from "./GGTestRuntime"
import {GGLog} from "@grest-ts/logger"
import {IPCClientRequest, IPCServer} from "@grest-ts/ipc";
import {GGContext} from "@grest-ts/context";
import {GG_TRACE} from "@grest-ts/trace";
import {GGLocatorKey} from "@grest-ts/locator";
import {GGTestComponent, GGTestComponentType} from "./testers/GGTestComponent";
import {IGGLocalDiscoveryServer} from "./IGGLocalDiscoveryServer";
import {TestableIPC} from "./callOn/TestableIPC";

export const GG_TEST_RUNNER = new GGLocatorKey<GGTestRunner>("GGTestRunner");

/**
 * Interface for test lifecycle hooks.
 * Registered via GGTest.registerHook() to run setup/teardown logic.
 */
export interface GGTestRunnerHook {
    /** Key name for deduplication (e.g., config key name) */
    keyName: string;
    /** Runs in beforeAll - setup logic */
    beforeAll: () => Promise<void>;
    /** Runs in afterAll - cleanup logic */
    afterAll: () => Promise<void>;
}

/**
 * Symbol for resources that support test operations.
 * Resources implement this to expose operations like clone().
 */
export const GG_TEST_RESOURCE = Symbol('GG_TEST_RESOURCE');

/**
 * Type for objects that expose test resource operations.
 * Used by GGTest.with() to get available operations.
 */
export interface TestResource<T = any> {
    [GG_TEST_RESOURCE]: T;
}

export interface GGTestConfig {
    serviceStartupTimeout: number
    verboseProxy: boolean
}

export class GGTestRunner {

    /**
     * Unique identifier for this test context.
     * Used for test resource isolation (e.g., creating isolated DB schemas).
     */
    public readonly testId: string
    public readonly ipcServer: IPCServer;
    public readonly discoveryServer: IGGLocalDiscoveryServer
    public readonly config: GGTestConfig = {
        serviceStartupTimeout: 30000,
        verboseProxy: false
    }
    private _started: boolean = false

    /**
     * Runtimes added in the describe block (before start).
     * These are managed by beforeAll/afterAll.
     */
    private readonly globalRuntimes: GGTestRuntime[] = []

    /**
     * Runtimes added within test blocks (after start).
     * These are managed by afterEach and cleared after each test.
     */
    private readonly inTestRuntimes: GGTestRuntime[] = []

    /**
     * Extension instances - extensions are some "describe block level components".
     * Some examples EventsServer, HttpInterceptorsServer, MockableInterceptorsServer etc.
     */
    private readonly extensionInstances = new Map<GGTestComponentType<any>, GGTestComponent>();

    private readonly hooks: Map<string, GGTestRunnerHook> = new Map()

    constructor(ipcServer: IPCServer, discoveryServer: IGGLocalDiscoveryServer, userConfig?: Partial<GGTestConfig>) {
        this.testId = "t" + Math.random().toString(36).substring(2, 8);
        this.config = {...this.config, ...userConfig};
        this.ipcServer = ipcServer;
        this.discoveryServer = discoveryServer;

        // Register IPC handler for key registration from workers
        this.ipcServer.onFrameworkMessage(TestableIPC.server.registerKeys, async (payload) => {
            const runtime = this.getRuntimeById(payload.runtimeId);
            if (runtime) {
                runtime.registerLocatorKeys(payload.keys);
                GGLog.debug(this, `Registered ${payload.keys.length} keys for runtime ${payload.runtimeId}`);
            } else {
                GGLog.warn(this, `Received key registration for unknown runtime: ${payload.runtimeId}`);
            }
        });
    }

    // -----------------------------------------------
    // Static component factory registry
    // -----------------------------------------------

    /**
     * Extension factories - extensions are some "describe block level components".
     * Some examples EventsServer, HttpInterceptorsServer, MockableInterceptorsServer etc.
     */
    private static extensionFactories: GGTestComponentType<any>[] = [];

    /**
     * Register a component type.
     * Components must accept GGTestRunner as their constructor argument.
     */
    public static registerExtension<T extends GGTestComponent>(type: GGTestComponentType<T>): void {
        this.extensionFactories.push(type);
    }

    // -----------------------------------------------
    // Component registry
    // -----------------------------------------------

    /**
     * Get a component by type. Creates it lazily if not yet instantiated.
     */
    public getExtensionInstance<T extends GGTestComponent>(type: GGTestComponentType<T>): T {
        if (!this.extensionInstances.has(type)) {
            const instance = new type(this);
            this.extensionInstances.set(type, instance);
        }
        return this.extensionInstances.get(type) as T;
    }


    // -----------------------------------------------
    // Instance methods
    // -----------------------------------------------

    /**
     * Whether the test has started (services are running).
     */
    public get started(): boolean {
        return this._started;
    }

    /**
     * Register a test lifecycle hook.
     * Hooks run beforeAll (during start) and afterAll (during teardown).
     * Duplicate registrations with the same keyName are skipped.
     */
    public registerHook(hook: GGTestRunnerHook): void {
        if (this.hooks.has(hook.keyName)) {
            GGLog.debug(this, `Hook already registered for ${hook.keyName}, skipping duplicate`);
            return;
        }
        this.hooks.set(hook.keyName, hook);
    }

    /**
     * Send a command to ALL runtimes.
     * Used by resource hooks (e.g., DB config) that apply globally.
     */
    public async sendCommand<Payload>(type: IPCClientRequest<Payload, any>, payload: Payload): Promise<void> {
        const promises = this.globalRuntimes.map(runtime => runtime.sendCommand(type, payload));
        await Promise.allSettled(promises)
    }


    /**
     * Add a runtime to this test runner.
     * Automatically routes to the appropriate list based on lifecycle stage.
     */
    public addRuntime(runtime: GGTestRuntime): void {
        if (this._started) {
            // Added within a test block - managed by afterEach
            this.inTestRuntimes.push(runtime);
        } else {
            // Added in describe block - managed by beforeAll/afterAll
            this.globalRuntimes.push(runtime);
        }
    }

    /**
     * Get all active runtimes (both global and in-test).
     */
    public getAllRuntimes(): GGTestRuntime[] {
        return [...this.globalRuntimes, ...this.inTestRuntimes];
    }

    /**
     * Find a runtime by its unique runtimeId.
     */
    public getRuntimeById(runtimeId: string): GGTestRuntime | undefined {
        return this.globalRuntimes.find(r => r.runtimeId === runtimeId)
            ?? this.inTestRuntimes.find(r => r.runtimeId === runtimeId);
    }

    public async start(): Promise<void> {
        await new GGContext("Test").run(async () => {
            GG_TRACE.init();
            if (this._started) {
                throw new Error("Already started!");
            }

            // 0. Initialize extension (testkits already loaded by vitest setup)
            for (const type of GGTestRunner.extensionFactories) {
                // Create extension instance, which registers its IPC handlers
                this.extensionInstances.set(type, new type(this));
            }

            // 1. Execute all hook beforeAll handlers in parallel
            const hookPromises = Array.from(this.hooks.entries()).map(async ([keyName, hook]) => {
                const startTime = performance.now();
                GGLog.debug(this, `Running beforeAll hook: ${keyName}`);
                await hook.beforeAll();
                const duration = (performance.now() - startTime).toFixed(0);
                GGLog.debug(this, `Completed beforeAll hook: ${keyName} (${duration}ms)`);
                return keyName;
            });

            const results = await Promise.allSettled(hookPromises);
            const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
            if (failures.length > 0) {
                const errorMessages = failures.map(f => {
                    const reason = f.reason;
                    if (reason instanceof AggregateError) {
                        const innerErrors = reason.errors?.map((e: any) => e?.message || String(e)).join(', ');
                        return `AggregateError[${innerErrors}]`;
                    }
                    return reason?.message || String(reason);
                }).join('; ');
                throw new Error(`Failed to run beforeAll hooks: ${errorMessages}`);
            }

            // 2. Start router
            await this.discoveryServer.start();

            // 3. Start components
            for (const [type, component] of this.extensionInstances) {
                if (component.start) {
                    GGLog.debug(this, `Starting component: ${type.name}`);
                    await component.start();
                }
            }

            // 4. Start runtimes (they will receive commands via env)
            for (const runtime of this.globalRuntimes) {
                await runtime.start()
            }
            this._started = true;
        });
    }

    public async runBeforeAllHooks(): Promise<void> {
        for (const [, component] of this.extensionInstances) {
            await component.beforeAll?.();
        }
    }

    public async runAfterAllHooks(): Promise<void> {
        for (const [, component] of this.extensionInstances) {
            await component.afterAll?.();
        }
    }

    public async runBeforeEachHooks(): Promise<void> {
        for (const [, component] of this.extensionInstances) {
            await component.beforeEach?.();
        }
    }

    public async runAfterEachHooks(): Promise<void> {
        for (const [, component] of this.extensionInstances) {
            await component.afterEach?.();
        }

        GGLog.debug(this, 'Stopping in-test runtimes...');
        for (const runtime of this.inTestRuntimes) {
            await runtime.shutdown();
        }
        this.inTestRuntimes.length = 0;
        GGLog.debug(this, 'All in-test runtimes stopped!');
    }

    public async teardown(): Promise<void> {
        await new GGContext("Test").run(async () => {
            GG_TRACE.init();
            // Stop global runtimes (teardown services, keep IPC alive)
            GGLog.debug(this, 'Stopping global runtimes...');
            for (const runtime of this.globalRuntimes) {
                await runtime.stop()
            }

            // Shutdown global runtimes (terminate workers/processes)
            GGLog.debug(this, 'Shutting down global runtimes...');
            for (const runtime of this.globalRuntimes) {
                await runtime.shutdown()
            }

            GGLog.debug(this, 'Tearing down router...');
            await this.discoveryServer.teardown();

            // Teardown components
            for (const [type, component] of this.extensionInstances) {
                if (component.teardown) {
                    GGLog.debug(this, `Tearing down component: ${type.name}`);
                    await component.teardown();
                }
            }
            this.extensionInstances.clear();

            GGLog.debug(this, 'Router torn down');

            // Run afterAll hooks
            GGLog.debug(this, 'Running afterAll hooks...');
            for (const [keyName, hook] of this.hooks) {
                try {
                    await hook.afterAll();
                    GGLog.debug(this, `Completed afterAll hook: ${keyName}`);
                } catch (error) {
                    GGLog.error(this, `Failed afterAll hook ${keyName}:`, error);
                }
            }

            this.globalRuntimes.length = 0
            this.hooks.clear()
        });
    }
}
