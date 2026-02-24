import {GGConfigStore} from "./GGConfigStore";
import {GGConfigKey, GGConfigKeyConstructor} from "./GGConfigKey";
import {GGLocator, GGLocatorServiceType} from "@grest-ts/locator";
import {GG_CONFIG} from "./GG_CONFIG";
import {ConfigValues, GGConfigStoreLocal} from "./stores/GGConfigStoreLocal";

export type GGConfigDefinition<T> = T & {
    __isGGConfigDefinition: never,
    __getKeysMap: () => ReadonlyMap<GGConfigKeyConstructor, GGConfigKey[]>
};

export class GGConfigLocator<T extends object> {

    #isStarted = false;
    readonly #config: GGConfigDefinition<T>;
    readonly #storesList: GGConfigStore<GGConfigKey>[] = []
    readonly #storesMap: Map<string, GGConfigStore<GGConfigKey>> = new Map()

    protected readonly localConfig: GGConfigStoreLocal<T, any> = undefined

    /**
     * @param config - Config definition.
     * @param localConfig - Optional local config values. If provided, stores will use this instead of the real values when not running in production.
     *  new GGConfigLocator(MyConfig, localConfig) is shorthand for this: new GGConfigLocator(MyConfig).add(AllKeys, new GGConfigStoreLocal(MyConfig, localConfig))
     */
    constructor(config: GGConfigDefinition<T>, localConfig?: ConfigValues<T>) {
        if (!config) throw new Error("Config definition is required");
        this.#config = config;
        this.localConfig = localConfig ? new GGConfigStoreLocal(config, localConfig) : undefined
        GGLocator.getScope().setWithLifecycle(GG_CONFIG, this, {
            type: GGLocatorServiceType.CONFIG,
            start: () => this.start(),
            teardown: () => this.teardown()
        });
    }

    /**
     * Can override this if you want custom handling.
     */
    public onNotifyError = (error: Error): never => {
        throw error;
    }

    /**
     * Add a config store for a key type.
     *
     * Note for framework development: Testkit overrides this function.
     */
    public add<Key extends GGConfigKey>(key: GGConfigKeyConstructor<Key> | GGConfigKeyConstructor<Key>[], store: GGConfigStore<Key>): this {
        return this._add(key, this._useLocalStoreIfNeeded(store))
    }

    protected _useLocalStoreIfNeeded<Key extends GGConfigKey>(store: GGConfigStore<Key>): GGConfigStore<Key> {
        if (process.env.NODE_ENV === "production" || !this.localConfig) {
            return store;
        } else {
            return this.localConfig;
        }
    }

    protected _add<Key extends GGConfigKey>(key: GGConfigKeyConstructor<Key> | GGConfigKeyConstructor<Key>[], store: GGConfigStore<Key>): this {
        if (this.#isStarted) {
            throw new Error("Cannot add store after config holder is started");
        }
        const keyTypes = Array.isArray(key) ? key : [key];
        const keysMap = this.#config.__getKeysMap();
        for (const keyType of keyTypes) {
            const keysForType = (keysMap.get(keyType) ?? []) as Key[];
            store.setKeys(keysForType);
            this.#storesMap.set(keyType.NAME, store as GGConfigStore<GGConfigKey>);
        }
        if (!this.#storesList.includes(store as GGConfigStore<GGConfigKey>)) {
            this.#storesList.push(store as GGConfigStore<GGConfigKey>);
        }
        return this;
    }

    public getStore<Key extends GGConfigKey>(keyType: GGConfigKeyConstructor<Key>): GGConfigStore<Key> {
        return this.getStoreByConfigKeyName(keyType.NAME);
    }

    public getStoreByConfigKeyName<Key extends GGConfigKey>(name: string): GGConfigStore<Key> {
        const store = this.#storesMap.get(name);
        if (!store) {
            throw new Error(`No store for store key: ${name ?? 'undefined'}.`);
        }
        return store as GGConfigStore<Key>
    }

    public getStores(): GGConfigStore<GGConfigKey>[] {
        return this.#storesList;
    }

    public async start(): Promise<void> {
        if (this.#isStarted) {
            throw new Error("Already started");
        }
        this.#isStarted = true;
        this.#config.__getKeysMap().forEach((_, keyType) => {
            if (!this.#storesMap.has(keyType.NAME)) {
                throw new Error(`Missing stores for config key type '${keyType.NAME}'`);
            }
        })
        Object.freeze(this.#storesMap);
        Object.freeze(this.#storesList);
        await Promise.all(this.#storesList.map((store) => store.start()));
    }

    public async teardown(): Promise<void> {
        await Promise.all(this.#storesList.map(s => s.teardown()));
    }
}
