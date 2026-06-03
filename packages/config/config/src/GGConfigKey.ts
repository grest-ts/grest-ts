import {GGConfig} from "./GGConfig";
import {assureValidConfigPath} from "./assureValidConfigPath";
import {GGValidator} from "@grest-ts/schema";
import {GG_CONFIG} from "./GG_CONFIG";

/**
 * Widens literal types to their base primitive type.
 * This allows T to be inferred from the validator while defaultValue accepts compatible values.
 * e.g., Widen<tPosInt> = number, so defaultValue can be 5000
 */
export type Widen<T> = T extends number ? number : T extends string ? string : T extends boolean ? boolean : T;

export type GGConfigKeyConstructor<T = unknown> = {
    readonly NAME: string,
    new(...args: any[]): GGConfigKey<T>
};

export abstract class GGConfigKey<T = unknown> {

    private static readonly registry = new Map<string, GGConfigKey>();

    public static hasKey(name: string): boolean {
        return GGConfigKey.registry.has(name);
    }

    public static getKey(name: string): GGConfigKey {
        const result = GGConfigKey.registry.get(name);
        if (result === undefined) {
            throw new Error(`Config key not found: ${name}`);
        }
        return result;
    }

    public readonly root: string;
    public readonly name: string;
    public readonly description: string | undefined;
    public readonly schema: GGValidator<T>;
    /** File location where this ConfigKey was defined (file:line:col) */
    public readonly definedAt: string | undefined;

    constructor(name: string, schema: GGValidator<T>, description: string) {
        this.definedAt = captureDefinitionLocation();
        const ctx = GGConfig.getCreationContext();
        ctx.add(this);
        this.root = ctx.name
        this.name = this.root + name;
        assureValidConfigPath(this.name);
        this.description = description;
        this.schema = schema;

        Object.freeze(this);

        if (GGConfigKey.registry.has(this.name)) {
            throw new Error(`Duplicate config key: ${this.name}`);
        }
        GGConfigKey.registry.set(this.name, this);
    }

    public getDefault(): T | undefined {
        return undefined;
    }

    protected getValue(): T {
        const store = this.getStore();
        if (!store.started) {
            throw new Error(`Cannot read config key "${this.name}" before the config store has been started.`);
        }
        return store.getValue(this);
    }

    public watch(listener: (value: T) => void): () => void {
        return this.getStore().watch(this, listener);
    }

    public abstract getStoreKey(): string;

    public getStore() {
        return GG_CONFIG.get().getStore(this.constructor as GGConfigKeyConstructor<any>);
    }
}

function captureDefinitionLocation(): string | undefined {
    const stack = new Error().stack;
    if (!stack) return undefined;

    /* This could be one possible error we are filtering for.
    Error
    at captureDefinitionLocation (\GG_ROOT\packages\config\src\GGConfigKey.ts:24:19)
    at new GGConfigKey (\GG_ROOT\packages\config\src\GGConfigKey.ts:60:26)
    at new GGResource (\GG_ROOT\packages\config\src\keys\GGResource.ts:3:8)
    at Object.createAwsSnsProviderConfig (\GG_ROOT\packages-libs\events\events-aws\src\AwsSnsAdapter.ts:26:19)
    at new EventPublisherConfig (\GG_ROOT\packages-libs\events\events\src\pub\EventPublisherConfig.ts:56:52)
    at EventPublisherResource.config (\GG_ROOT\packages-libs\events\events\src\pub\EventPublisherResource.ts:39:16)
    at <anonymous> (\GG_ROOT\examples\checklist\checklist\ChecklistConfig.ts:26:41)
    at AsyncLocalStorage.run (node:internal/async_local_storage/async_context_frame:63:14)
    at GGConfig.define (\GG_ROOT\packages\config\src\GGConfig.ts:27:38)
    at <anonymous> (\GG_ROOT\examples\checklist\checklist\ChecklistConfig.ts:8:41)
     */
    const lines = stack.split('\n').reverse();
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        // Remember that minification might change the names of things.
        if (lines[i - 1]?.includes('at AsyncLocalStorage.run ') && line?.includes('at <anonymous>')) {
            return line.substring(0, line.length - 1).trim().replace("at <anonymous> (", "")
        }
    }
    return stack;
}