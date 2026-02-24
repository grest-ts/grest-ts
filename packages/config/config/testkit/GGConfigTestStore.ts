import {GGConfigKey, GGConfigKeyConstructor} from "../src/GGConfigKey";
import {ConfigUpdateCallback, GGConfigStore} from "../src/GGConfigStore";
import {GGConfigLocator} from "../src/GGConfigLocator";
import {GG_TEST_RUNTIME_WORKER, GGTestCommand} from "@grest-ts/testkit";
import {ConfigUpdatePayload, GGConfigIPC} from "./GGConfigCommands";

/**
 * Test config store that wraps a parent store and allows overriding values.
 * Overrides validation to always throw (fail fast in tests).
 */
export class GGConfigTestStore<Key extends GGConfigKey = GGConfigKey> extends GGConfigStore<Key> {

    private readonly wrappedStore: GGConfigStore<Key>;
    private readonly initialConfigOverridesMap: Map<GGConfigKey, unknown> = new Map();
    private readonly activeConfigOverridesMap: Map<GGConfigKey, unknown> = new Map();

    constructor(parent: GGConfigStore<Key>, initialOverrides: GGTestCommand<ConfigUpdatePayload>[]) {
        super();
        this.wrappedStore = parent;
        for (const command of initialOverrides) {
            if (GGConfigKey.hasKey(command.payload.keyName)) {
                const key = GGConfigKey.getKey(command.payload.keyName);
                const value = this.resolveValue(key, command.payload.value, true)
                this.initialConfigOverridesMap.set(key, value)
                this.activeConfigOverridesMap.set(key, value);
            } else {
                // To throw here, we would need to let the test runner know what config keys each service uses so it can target config updates better.
            }
        }
    }

    public override setKeys(keys: readonly Key[]): void {
        super.setKeys(keys);
        this.wrappedStore.setKeys(keys);
    }

    public override getValue<T>(key: GGConfigKey<T>): T {
        return this.activeConfigOverridesMap.has(key) ? this.activeConfigOverridesMap.get(key) as T : this.wrappedStore.getValue(key)
    }

    public async updateValueOverride(key: GGConfigKey, value: unknown): Promise<void> {
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            const existingValue = this.activeConfigOverridesMap.get(key) ?? this.wrappedStore.getValue(key);
            if (existingValue !== null && typeof existingValue === 'object' && !Array.isArray(existingValue)) {
                value = {...existingValue, ...value};
            }
        }
        return this.replaceValueOverride(key, value)
    }

    public async replaceValueOverride(key: GGConfigKey, value: unknown): Promise<void> {
        this.activeConfigOverridesMap.set(key, this.resolveValue(key, value, false));
        await this.notify(key);
    }

    public async resetAfterTest(): Promise<void> {
        this.activeConfigOverridesMap.clear();
        for (const [key, value] of this.initialConfigOverridesMap) {
            await this.replaceValueOverride(key, value);
        }
    }

    public override watch(key: GGConfigKey, callback: ConfigUpdateCallback): () => void {
        this.wrappedStore.watch(key, async (): Promise<void> => {
            // We only notify of the change if we don't have overrides. If we have override, then for watcher config value doesn't change.
            if (!this.activeConfigOverridesMap.has(key)) {
                return this.notify(key)
            }
        });
        return super.watch(key, callback)
    }

    public override async start() {
        await this.wrappedStore.start();
        await super.start();
    }

    public override async teardown(): Promise<void> {
        await this.wrappedStore.teardown();
        await super.teardown();
    }
}

const wrapperMap = new WeakMap<GGConfigStore<any>, GGConfigTestStore>();
GGConfigLocator.prototype.add = function <Key extends GGConfigKey>(key: GGConfigKeyConstructor<Key> | GGConfigKeyConstructor<Key>[], store: GGConfigStore<Key>): GGConfigLocator<Key> {
    store = this._useLocalStoreIfNeeded(store);
    const initialOverrides = GG_TEST_RUNTIME_WORKER.get().getInitialCommandsFor(GGConfigIPC.worker.update);
    let wrapped = wrapperMap.get(store) as GGConfigTestStore<Key> | undefined;
    if (!wrapped) {
        wrapped = new GGConfigTestStore(store, initialOverrides);
        wrapperMap.set(store, wrapped as GGConfigTestStore);
    }
    this._add(key, wrapped);
    return this
};
