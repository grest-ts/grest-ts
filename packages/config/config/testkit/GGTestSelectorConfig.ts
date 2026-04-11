import {GGTestAction, GGTestRuntime, GGTestSelector, GGTestSelectorExtension, RuntimeConstructor, tActionRawData} from "@grest-ts/testkit";
import {GGConfigKey} from "../src/GGConfigKey";
import {GGConfigIPC} from "./GGConfigCommands";
import {GGConfigTestComponent} from "./GGConfigTestComponent";
import {GGContext} from "@grest-ts/context";

export class GGTestSelectorConfig extends GGTestSelectorExtension {

    public static readonly PROPERTY_NAME = "config"

    update<V>(key: GGConfigKey<V>, value: Partial<V>): GGTestConfigUpdateAction<V> {
        return new GGTestConfigUpdateAction(this.runtimes, key, value, 'update');
    }

    replace<V>(key: GGConfigKey<V>, value: V): GGTestConfigUpdateAction<V> {
        return new GGTestConfigUpdateAction(this.runtimes, key, value, 'replace');
    }

    async get<V>(key: GGConfigKey<V>): Promise<V> {
        if (this.runtimes.length === 0) {
            throw new Error("No runtimes selected for config.get()");
        }
        // Get from first runtime (all should have same config)
        const result = await this.runtimes[0].sendCommand(GGConfigIPC.worker.get, {
            storeName: key.getStoreKey(),
            keyName: key.name,
        });
        return result as V;
    }
}

export class GGTestConfigUpdateAction<V> extends GGTestAction<void> {

    private readonly runtimes: GGTestRuntime[];
    private readonly key: GGConfigKey<V>;
    private readonly value: V | Partial<V>;
    private readonly mode: 'update' | 'replace';

    constructor(runtimes: GGTestRuntime[], key: GGConfigKey<V>, value: V | Partial<V>, mode: 'update' | 'replace') {
        super(new GGContext("GGTestConfigAccess"), {
            noResponse: true,
            logData: {
                message: `[Config ${mode} ${key.name} ${key.getStoreKey()}]`,
                request: value
            }
        });
        this.runtimes = runtimes;
        this.key = key;
        this.value = value;
        this.mode = mode;
    }

    protected async executeAction(): Promise<tActionRawData> {
        const command = this.mode === 'update' ? GGConfigIPC.worker.update : GGConfigIPC.worker.replace;
        await Promise.all(this.runtimes.map(async runtime => {
            await runtime.runner.getExtensionInstance(GGConfigTestComponent).markConfigModified();
            return runtime.sendCommand(command, {
                storeName: this.key.getStoreKey(),
                keyName: this.key.name,
                value: this.value
            })
        }));
        return undefined;
    }
}

declare module "@grest-ts/testkit" {
    interface SelectorExtensions<T extends RuntimeConstructor[]> {
        config: GGTestSelectorConfig;
    }
}

GGTestSelector.addExtension(GGTestSelectorConfig);
