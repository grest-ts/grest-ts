import {GGConfigKey} from "./GGConfigKey";
import {GG_CONFIG} from "./GG_CONFIG";
import type {GGIssuesList} from "@grest-ts/schema";
import {isDeepStrictEqual} from "node:util";

export type ConfigUpdateCallback = (value: any) => void | Promise<void>;

/**
 * Important when extending: Use resolveValue() / resolveValues() to resolve and validate config values.
 * start() may be called again after it throws (GGConfigLocator startupRetryMs): load and validate before calling super.start().
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
        const check = validate(key, storeValue);
        if (check.success === false) throw validationError([describeFailure(key, check.issues)], isInitialLoad);
        return check.value;
    }

    /**
     * resolveValue() for every key of this store: validates all of them and throws one error naming every failing key.
     */
    protected resolveValues(read: (key: Key) => unknown, isInitialLoad: boolean = false): Map<GGConfigKey, unknown> {
        const values = new Map<GGConfigKey, unknown>();
        const failures: string[] = [];
        for (const key of this.keys) {
            const check = validate(key, read(key));
            if (check.success === false) {
                failures.push(describeFailure(key, check.issues));
            } else {
                values.set(key, check.value);
            }
        }
        if (failures.length > 0) throw validationError(failures, isInitialLoad);
        return values;
    }

    /**
     * After a reload: notifies watchers of the keys whose value changed, routing their errors to GGConfigLocator.onReloadError.
     */
    protected async notifyChanged(previous: ReadonlyMap<GGConfigKey, unknown>, next: ReadonlyMap<GGConfigKey, unknown>): Promise<void> {
        const changed = this.keys.filter(key => !isDeepStrictEqual(previous.get(key), next.get(key)));
        await Promise.all(changed.map(key => this.notify(key).catch(this.reportReloadError)));
    }

    protected reportReloadError = (error: Error): void => GG_CONFIG.get().onReloadError(error);

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

function validate<T>(key: GGConfigKey<T>, storeValue: unknown) {
    return key.schema.safeParse(storeValue !== undefined ? storeValue : key.getDefault());
}

// Issue messages only: a failing value may be (part of) a secret.
function describeFailure(key: GGConfigKey, issues: GGIssuesList): string {
    return `"${key.name}": ${issues.toMessage()}${key.definedAt ? ` (defined at ${key.definedAt})` : ""}`;
}

function validationError(failures: string[], isInitialLoad: boolean): Error {
    return new Error(`Config validation failed during ${isInitialLoad ? "initial-load" : "reload"}:\n\t${failures.join("\n\t")}`);
}
