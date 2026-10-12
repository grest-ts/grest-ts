import {GGConfigDefinition} from "./GGConfigLocator";
import {AsyncLocalStorage} from "node:async_hooks";
import {GGConfigKey, GGConfigKeyConstructor} from "./GGConfigKey";
import {ConstructorOf} from "@grest-ts/common";
import {readConfigPath, writeConfigPath} from "./configPath";

export interface GGConfigKeyCreationContext {
    name: string
    add: (key: GGConfigKey) => void;
}

const defineContext = new AsyncLocalStorage<GGConfigKeyCreationContext>();

export interface GGConfigKeyInfo {
    readonly name: string
    /** Key type NAME, e.g. "[GGSetting]". */
    readonly type: string
    /** No default and the schema rejects undefined: every store must provide it. */
    readonly required: boolean
    readonly default: unknown
    readonly description: string | undefined
    readonly definedAt: string | undefined
}

export interface GGConfigCheckResult {
    readonly missing: string[]
    readonly invalid: { name: string, issues: unknown }[]
    readonly defaulted: string[]
    /** Document paths no key reads. */
    readonly unknown: string[]
    /** A store loading this document would start. */
    readonly ok: boolean
}

export interface GGConfigDocumentOptions {
    /** Limit to these key types (the ones a single store serves). Default: all. */
    readonly types?: readonly GGConfigKeyConstructor[]
}

export class GGConfig {

    public static define<T>(name: string, define: () => T): GGConfigDefinition<T> {
        const keysMap: Map<ConstructorOf<GGConfigKey>, GGConfigKey[]> = new Map()
        const ctx: GGConfigKeyCreationContext = Object.freeze({
            name,
            add: (key: GGConfigKey) => {
                const cls = key.constructor as ConstructorOf<GGConfigKey>;
                let list = keysMap.get(cls)
                if (!list) {
                    list = []
                    keysMap.set(cls, list)
                }
                list.push(key)
            }
        });
        const result = defineContext.run(ctx, define) as GGConfigDefinition<T>;
        keysMap.forEach(list => Object.freeze(list))
        result.__getKeysMap = ((cls: ConstructorOf<GGConfigKey>) => keysMap) as any
        Object.freeze(result);
        return result
    }

    public static getCreationContext(): GGConfigKeyCreationContext {
        const store = defineContext.getStore()
        if (!store) {
            throw new Error("No prefix defined in context")
        }
        return store;
    }

    public static describe(config: GGConfigDefinition<any>, options?: GGConfigDocumentOptions): GGConfigKeyInfo[] {
        return this.keysOf(config, options).map(key => ({
            name: key.name,
            type: key.getStoreKey(),
            required: isRequired(key),
            default: key.getDefault(),
            description: key.description,
            definedAt: key.definedAt,
        }));
    }

    /**
     * Checks a JSON config document (what a file / Secrets Manager store would load) against the
     * definition, without starting a store. A required key set to null counts as missing, so a
     * template() skeleton reports exactly what is left to fill in.
     */
    public static check(config: GGConfigDefinition<any>, document: unknown, options?: GGConfigDocumentOptions): GGConfigCheckResult {
        const keys = this.keysOf(config, options);
        const missing: string[] = [];
        const invalid: { name: string, issues: unknown }[] = [];
        const defaulted: string[] = [];
        for (const key of keys) {
            let value = readConfigPath(document, key.name);
            const required = isRequired(key);
            // Only a required key's null is a template placeholder; anywhere else null is a real value the stores validate.
            if (value === undefined || (value === null && required && !key.schema.safeParse(null).success)) {
                if (required) {
                    missing.push(key.name);
                    continue;
                }
                value = key.getDefault();
                if (value !== undefined) defaulted.push(key.name);
            }
            const check = key.schema.safeParse(value);
            if (check.success === false) invalid.push({name: key.name, issues: check.issues.toJSON()});
        }
        const unknown: string[] = [];
        collectUnknown(document, "", keys.map(k => k.name), unknown);
        unknown.sort();
        return {missing, invalid, defaulted, unknown, ok: missing.length === 0 && invalid.length === 0};
    }

    /** JSON skeleton of a document: required keys as null; defaults only when asked for. */
    public static template(config: GGConfigDefinition<any>, options?: GGConfigDocumentOptions & { includeDefaults?: boolean }): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        for (const key of this.keysOf(config, options)) {
            if (isRequired(key)) writeConfigPath(result, key.name, null);
            else if (options?.includeDefaults && key.getDefault() !== undefined) writeConfigPath(result, key.name, key.getDefault());
        }
        return result;
    }

    private static keysOf(config: GGConfigDefinition<any>, options?: GGConfigDocumentOptions): GGConfigKey[] {
        const keys: GGConfigKey[] = [];
        config.__getKeysMap().forEach((list: GGConfigKey[], type: GGConfigKeyConstructor) => {
            if (!options?.types || options.types.includes(type)) keys.push(...list);
        });
        return keys.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    }

    public static toJSON(config: GGConfigDefinition<any>): Record<string, unknown> {
        const result: Record<string, Record<string, unknown>> = {};
        this.collectKeys(config, result);
        return result;
    }

    private static collectKeys(obj: unknown, result: Record<string, Record<string, unknown>>): void {
        if (obj instanceof GGConfigKey) {
            const storeKey = obj.getStoreKey();
            if (!result[storeKey]) {
                result[storeKey] = {};
            }
            const segments = obj.name.split('/').filter(s => s.length > 0);
            let current: Record<string, unknown> = result[storeKey];
            for (let i = 0; i < segments.length - 1; i++) {
                if (!current[segments[i]]) {
                    current[segments[i]] = {};
                }
                current = current[segments[i]] as Record<string, unknown>;
            }
            current[segments[segments.length - 1]] = obj.getDefault();
        } else if (obj && typeof obj === 'object') {
            for (const value of Object.values(obj)) {
                this.collectKeys(value, result);
            }
        }
    }

}

function isRequired(key: GGConfigKey): boolean {
    return key.getDefault() === undefined && !key.schema.safeParse(undefined).success;
}

function collectUnknown(node: unknown, path: string, keyNames: readonly string[], out: string[]): void {
    if (keyNames.includes(path)) return;
    const isBranch = path === "" || keyNames.some(name => name.startsWith(path + "/"));
    if (!isBranch) {
        out.push(path);
        return;
    }
    if (node && typeof node === "object" && !Array.isArray(node)) {
        for (const [k, v] of Object.entries(node)) collectUnknown(v, path + "/" + k, keyNames, out);
    }
}
