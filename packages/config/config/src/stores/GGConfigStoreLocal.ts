import {GGConfigStore} from "../GGConfigStore";
import {GGConfigKey, Widen} from "../GGConfigKey";
import {deepFreeze} from "@grest-ts/common";

/**
 * Extracts the keys from T that are GGConfigKey instances or objects containing them.
 * Uses a depth limit (D) to prevent infinite recursion on circular types (e.g. GGSchema).
 */
type ConfigKeyOf<T, D extends 1[] = []> = D['length'] extends 5 ? never : {
    [K in keyof T]: [T[K]] extends [never] ? never :
        T[K] extends GGConfigKey<any> ? K :
            T[K] extends Function ? never :
                T[K] extends object ? (ConfigKeyOf<T[K], [...D, 1]> extends never ? never : K) : never
}[keyof T];

/**
 * Maps a config definition to the shape of values it expects.
 * GGConfigKey<V> → V, objects with config keys → recurse, everything else → excluded.
 */
export type ConfigValues<T, D extends 1[] = []> =
    D['length'] extends 5 ? never :
        T extends GGConfigKey<infer V> ? Widen<V> :
            T extends object ? (
                ConfigKeyOf<T, D> extends never ? never : { [K in ConfigKeyOf<T, D>]: ConfigValues<T[K], [...D, 1]> }
                ) : never;

/**
 * Type-checks a local config values object against a config definition.
 * Returns the values object as-is — this is a compile-time helper, not a store.
 *
 * Use with GGConfigStoreLocal in your runtime's compose():
 * @example
 * ```typescript
 * // config/local.ts — just data:
 * export default createLocalConfig(MyConfig, {
 *     mysql: {
 *         host: { host: "localhost", port: 3306, database: "mydb" },
 *         user: { username: "root", password: "root" },
 *     },
 *     jwtSecret: "dev-secret",
 * })
 *
 * // runtime.ts — fresh store per compose():
 * import localConfig from "./config/local.js";
 * new GGConfigLocator(MyConfig)
 *     .add([GGResource, GGSecret], new GGConfigStoreLocal(MyConfig, localConfig))
 * ```
 */
export function createLocalConfig<T extends object>(_config: T, values: ConfigValues<T>): ConfigValues<T> {
    deepFreeze(values)
    return values;
}

/**
 * Type-safe local development config store.
 * Refuses to start in production — crashes immediately if NODE_ENV is "production".
 * Use createLocalConfig() for the best DX, or .set() for manual control.
 */
export class GGConfigStoreLocal<Struct extends object, Key extends GGConfigKey = GGConfigKey> extends GGConfigStore<Key> {

    readonly #values = new Map<GGConfigKey, unknown>();
    readonly #valuesCache = new Map<GGConfigKey, unknown>();

    constructor(config: Struct, values: ConfigValues<Struct>) {
        super();
        walkAndSet(this, config, values);
    }

    public set<T>(key: GGConfigKey<T>, value: T): this {
        this.#values.set(key, value);
        return this;
    }

    public override async start(): Promise<void> {
        if (process.env.NODE_ENV === "production") {
            throw new Error(
                "GGConfigStoreLocal cannot be used in production. " +
                "Use GGConfigStoreAwsSecretsManager or another production-safe store."
            );
        }

        this.keys.forEach(key => {
            this.#valuesCache.set(key, this.resolveValue(key, this.#values.get(key), true));
        });

        await super.start();
    }

    public override async teardown(): Promise<void> {
        this.#valuesCache.clear();
        await super.teardown();
    }

    public getValue<T>(key: GGConfigKey<T>): T {
        return this.#valuesCache.get(key) as T;
    }

}

function walkAndSet(store: GGConfigStoreLocal<any>, config: any, values: any) {
    for (const prop of Object.keys(values)) {
        const configEntry = config[prop];
        const value = values[prop];
        if (configEntry instanceof GGConfigKey) {
            store.set(configEntry, value);
        } else if (configEntry != null && typeof configEntry === 'object' && value != null && typeof value === 'object') {
            walkAndSet(store, configEntry, value);
        }
    }
}