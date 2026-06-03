import {GGConfigKey} from "./GGConfigKey";
import {GG_CONFIG} from "./GG_CONFIG";

export type ConfigUpdateCallback = (value: any) => void | Promise<void>;

/**
 * Important when extending: Use resolveValue() to resolve and validate config values.
 */
export abstract class GGConfigStore<Key extends GGConfigKey> {

    #keys: Key[] = []
    public get keys(): readonly Key[] { return this.#keys }
    readonly #watchers: Map<GGConfigKey, ConfigUpdateCallback[]> = new Map()

    protected isStarted = false;

    public get started(): boolean {
        return this.isStarted;
    }

    public setKeys(keys: readonly Key[]): void {
        if (this.isStarted) {
            throw new Error(`Cannot set keys after store is started: ${this.constructor.name}`);
        }
        this.#keys.push(...keys);
    }

    public abstract getValue<T>(key: GGConfigKey<T>): T

    /**
     * Resolves the final value for a config key: uses storeValue if present, falls back to key.getDefault(),
     * then validates against schema. If the resolved value is undefined and the schema doesn't allow it,
     * validation will fail — this is how missing required keys are caught.
     */
    protected resolveValue<T>(key: GGConfigKey<T>, storeValue: unknown, isInitialLoad: boolean = false): T {
        const val = storeValue !== undefined ? storeValue : key.getDefault();
        const check = key.schema.safeParse(val);
        if (check.success === false) {
            const errors = JSON.stringify(check.issues.toJSON(), null, 2).replaceAll("\n", "\n\t\t")
            throw new Error(`Config validation failed for "${key.name}" during ${isInitialLoad ? "initial-load" : "reload"}.\n\tDefined at:\n\t\t${key.definedAt}\n\tIssues:\n\t\t${errors}`);
        } else {
            return check.value as T;
        }
    }

    public async start(): Promise<void> {
        if (this.isStarted === true) {
            throw new Error(`Config store already started: ${this.constructor.name}`);
        }
        this.isStarted = true;
        Object.freeze(this.#keys);

        this.keys.forEach(key => {
            this.getValue(key); // Get every value so that config values are definitely initialized (or they would throw)
        });
    }

    public async teardown(): Promise<void> {
        this.#watchers.clear();
        this.isStarted = false;
    }

    public watch(key: GGConfigKey, callback: ConfigUpdateCallback): () => void {
        if (!this.#watchers.has(key)) {
            this.#watchers.set(key, []);
        }
        this.#watchers.get(key)!.push(callback);
        return () => {
            const list = this.#watchers.get(key);
            if (!list) return;
            const index = list.indexOf(callback);
            if (index >= 0) list.splice(index, 1);
        };
    }

    public async notify(key: GGConfigKey) {
        const watchers = this.#watchers.get(key);
        if (watchers) {
            const promises: Promise<void>[] = [];
            const newValue = this.getValue(key);
            watchers.forEach(callback => {
                try {
                    const result = callback(newValue);
                    if (result instanceof Promise) {
                        promises.push(result);
                    }
                } catch (err) {
                    GG_CONFIG.get().onNotifyError(err instanceof Error ? err : new Error(String(err)));
                }
            })
            if (promises.length > 0) {
                const results = await Promise.allSettled(promises);
                for (const result of results) {
                    if (result.status === 'rejected') {
                        GG_CONFIG.get().onNotifyError(result.reason);
                    }
                }
            }
        }
    }
}
