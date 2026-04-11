import {GGConfigKey, GGConfigKeyConstructor} from "../src/GGConfigKey";
import {ConfigUpdateCallback, GGConfigStore} from "../src/GGConfigStore";
import {GGConfigLocator} from "../src/GGConfigLocator";
import {GG_TEST_RUNTIME_WORKER, GGTestCommand} from "@grest-ts/testkit";
import {ConfigUpdatePayload, GGConfigIPC} from "./GGConfigCommands";

const NOT_SET = Symbol('NOT_SET');

/**
 * Test config store that wraps a parent store and allows overriding values.
 * Overrides validation to always throw (fail fast in tests).
 *
 * Uses a per-key undo journal for test isolation: before modifying a key for the first time
 * during a test, the previous value (or absence) is recorded. On resetAfterTest(), only
 * those keys are reverted — preserving any overrides set during beforeAll or other setup.
 */
export class GGConfigTestStore<Key extends GGConfigKey = GGConfigKey> extends GGConfigStore<Key> {

    private readonly wrappedStore: GGConfigStore<Key>;
    private readonly activeConfigOverridesMap: Map<GGConfigKey, unknown> = new Map();

    /**
     * Tracks pre-modification state for keys changed during the current test.
     * null when tracking is not active; created by enableTestTracking().
     * Values are either the previous override value or NOT_SET if the key had no override.
     */
    private testUndoLog: Map<GGConfigKey, unknown> | null = null;

    constructor(parent: GGConfigStore<Key>, initialOverrides: GGTestCommand<ConfigUpdatePayload>[]) {
        super();
        this.wrappedStore = parent;
        for (const command of initialOverrides) {
            if (GGConfigKey.hasKey(command.payload.keyName)) {
                const key = GGConfigKey.getKey(command.payload.keyName);
                const value = this.resolveValue(key, command.payload.value, true)
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

    public enableTestTracking(): void {
        if (this.testUndoLog === null) {
            this.testUndoLog = new Map();
        }
    }

    private trackForUndo(key: GGConfigKey): void {
        if (this.testUndoLog === null) return;
        if (!this.testUndoLog.has(key)) {
            this.testUndoLog.set(key, this.activeConfigOverridesMap.has(key)
                ? this.activeConfigOverridesMap.get(key)
                : NOT_SET
            );
        }
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
        this.trackForUndo(key);
        this.activeConfigOverridesMap.set(key, this.resolveValue(key, value, false));
        await this.notify(key);
    }

    public async resetAfterTest(): Promise<void> {
        if (!this.testUndoLog) return;
        for (const [key, previousValue] of this.testUndoLog) {
            if (previousValue === NOT_SET) {
                this.activeConfigOverridesMap.delete(key);
            } else {
                this.activeConfigOverridesMap.set(key, previousValue);
            }
        }
        this.testUndoLog = null;
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
