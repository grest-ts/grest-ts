import {IPCClient, IPCClientRequest} from "@grest-ts/ipc";
import {GGLog} from "@grest-ts/logger";
import {GGLoggerConsole} from "@grest-ts/logger-console";
import {GGRuntime} from "@grest-ts/runtime";
import {GGLocatorKey, GGLocatorScope} from "@grest-ts/locator";
import {pathToFileURL} from "url";
import {GGTestCommand, GGTestEnvConfig} from "./GGTestRuntime";
import {GGExtensionDiscovery} from "@grest-ts/common";
import {type MockableTestContext, runWithMockableContext} from "@grest-ts/testkit-runtime";
import {CALL_THROUGH} from "./mockable/GGMockableInterceptorsServer";
import {GGMockableIPC} from "./mockable/GGMockableIPC";
import {registerOnCallHandler} from "./callOn/registerOnCallHandler";
import {TestableIPC} from "./callOn/TestableIPC";

export const GG_TEST_RUNTIME_WORKER = new GGLocatorKey<GGTestRuntimeWorker>("GGTestRuntimeWorker");

export class GGTestRuntimeWorker {

    private static beforeRuntimeStartHandlers: (() => void)[] = [];
    private static beforeRuntimeStartExecuted = false;

    public readonly ipcClient: IPCClient;
    public readonly config: GGTestEnvConfig;
    public runtime!: GGRuntime
    private runtimeStopped = false;

    private readonly scope: GGLocatorScope;

    constructor(config: GGTestEnvConfig) {
        this.ipcClient = new IPCClient(config.testRouterPort);
        this.config = config;
        this.scope = new GGLocatorScope("GGTestRuntimeWorker").enter();
        this.scope.set(GG_TEST_RUNTIME_WORKER, this);
        GGLog.init();
        GGLog.add(new GGLoggerConsole({showData: true}));
    }

    /**
     * Register a function to be called before the runtime starts.
     * Safe to call at module load time - just adds to array.
     * Handlers are executed during start() after extensions are loaded but before runtime creation.
     */
    public static onBeforeRuntimeStart(handler: () => void): void {
        if (this.beforeRuntimeStartExecuted) {
            throw new Error("Cannot register beforeRuntimeStart handler after worker has started");
        }
        this.beforeRuntimeStartHandlers.push(handler);
    }

    public async start(createRuntime?: () => GGRuntime): Promise<void> {
        process.env.GG_LOCAL_ROUTER_PORT = String(this.config.testRouterPort);

        await new GGExtensionDiscovery('testkit').load();

        // Create mockable context that bridges to IPC
        const mockableContext: MockableTestContext = {
            CALL_THROUGH,
            sendCall: async (className, methodName, callArgs) => {
                return this.ipcClient.sendFrameworkRequest(GGMockableIPC.testServer.call, {
                    className,
                    methodName,
                    callArgs
                });
            },
            sendSpyResult: async (className, methodName, callResult) => {
                await this.ipcClient.sendFrameworkRequest(GGMockableIPC.testServer.spyResult, {
                    className,
                    methodName,
                    callResult
                });
            }
        };

        // Wrap in mockable context so @mockable decorators can intercept
        await runWithMockableContext(mockableContext, async () => {
            await this.ipcClient.connect(this.config.runtimeId);
            GGLog.debug(this, 'Connected to test router');

            // Register testable handler for direct service invocation from tests
            registerOnCallHandler(this);

            GGTestRuntimeWorker.beforeRuntimeStartExecuted = true;
            GGTestRuntimeWorker.beforeRuntimeStartHandlers.forEach(handler => handler());

            if (createRuntime) {
                this.runtime = createRuntime();
            } else {
                // Dynamic import of the runtime source file.
                // Always use file:// URL — required by Node ESM on Windows.
                const moduleUrl = this.config.executablePath.startsWith('file:')
                    ? this.config.executablePath
                    : pathToFileURL(this.config.executablePath).href;
                const module = await import(moduleUrl);
                const RuntimeClass = module[this.config.className];
                if (!RuntimeClass) {
                    throw new Error(
                        `Runtime class '${this.config.className}' not found in module '${this.config.executablePath}'. ` +
                        `Make sure the class is exported.`
                    );
                }
                this.runtime = new RuntimeClass();
            }
            await this.runtime!.start();

            // Send registered locator keys to test runner for callOn routing
            const keys = this.runtime!.scope.getKeys();
            await this.ipcClient.sendFrameworkRequest(TestableIPC.server.registerKeys, {
                runtimeId: this.config.runtimeId,
                keys
            });
            GGLog.debug(this, `Sent ${keys.length} locator keys to test runner`);
        });
    }

    /**
     * Stop the GGRuntime (teardown services) but keep IPC alive.
     * The runtime reference is kept so IPC handlers can still access
     * async contexts (logs, metrics, config) via runInContext().
     */
    public async stopRuntime(): Promise<void> {
        if (this.runtimeStopped) return;
        this.runtimeStopped = true;
        if (this.runtime) {
            await this.runtime.scope.run(() => this.runtime!.teardown());
        }
    }

    /**
     * Register an IPC request handler that automatically runs within the runtime's context.
     * Use this instead of ipcClient.onFrameworkRequest() for handlers that need access to
     * runtime services (logs, metrics, config, etc.) even after runtime.stop().
     */
    public onIpcRequest<Req, Res>(
        type: IPCClientRequest<Req, Res>,
        handler: (payload: Req) => Res | Promise<Res>
    ): void {
        this.ipcClient.onFrameworkRequest(type, async (payload) => {
            if (this.runtime) {
                return this.runtime.scope.run(() => handler(payload));
            }
            return handler(payload);
        });
    }

    /**
     * Fully shutdown the worker, including IPC disconnection.
     * Calls stopRuntime() if not already stopped.
     */
    public async shutdown(): Promise<void> {
        if (!this.runtimeStopped) {
            await this.stopRuntime();
        }
        this.ipcClient.disconnect();
    }

    public getInitialCommandsFor<Payload>(type: IPCClientRequest<Payload, any>): GGTestCommand<Payload>[] {
        return this.config.initialCommands.filter(cmd => cmd.method === type) as GGTestCommand<Payload>[];
    }
}
