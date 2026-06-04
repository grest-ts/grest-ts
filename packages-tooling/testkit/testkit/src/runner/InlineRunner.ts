import type {RuntimeRunner} from "./RuntimeRunner";
import {GGTestRuntimeWorker} from "../GGTestRuntimeWorker";
import {GGTestEnvConfig} from "../GGTestRuntime";
import {GGLocatorScope} from "@grest-ts/locator";

export class InlineRunner implements RuntimeRunner {

    private controlClient?: GGTestRuntimeWorker;
    private readonly config: GGTestEnvConfig
    private readonly runtimeFactory?: () => any

    constructor(
        config: GGTestEnvConfig,
        runtimeFactory?: () => any
    ) {
        this.config = config
        this.runtimeFactory = runtimeFactory
    }

    async start(): Promise<void> {
        // Use setTimeout + enterBlank() to create a fully isolated async context.
        // This gives the inline runtime its own context tree where GGLog.init()
        // creates an independent log context, similar to how Worker/Isolated modes
        // naturally get separate contexts by running in different threads/processes.
        const factory = this.runtimeFactory;
        await new Promise<void>((resolve, reject) => {
            setTimeout(async () => {
                try {
                    // Create blank context - inline runtime should not inherit test context
                    new GGLocatorScope("GGInlineRunner").enter();
                    this.controlClient = new GGTestRuntimeWorker(this.config);
                    // Pass factory to avoid dynamic import() which causes duplicate
                    // module loading in Vite/vitest environments
                    await this.controlClient.start(factory);
                    resolve();
                } catch (err) {
                    reject(err);
                }
            }, 0);
        });
    }

    async stopRuntime(): Promise<void> {
        await this.controlClient?.stopRuntime();
    }

    async shutdown(): Promise<void> {
        await this.controlClient?.shutdown();
        this.controlClient = undefined;
    }
}
