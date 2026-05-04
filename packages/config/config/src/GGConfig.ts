import {GGConfigDefinition} from "./GGConfigLocator";
import {AsyncLocalStorage} from "node:async_hooks";
import {GGConfigKey} from "./GGConfigKey";
import {ConstructorOf, getOrInstallGlobal} from "@grest-ts/common";

export interface GGConfigKeyCreationContext {
    name: string
    add: (key: GGConfigKey) => void;
}

// Globally-keyed AsyncLocalStorage so duplicate module loads share a single
// instance. Without this, a bundled copy of @grest-ts/config and a
// node_modules copy each get their own ALS — `define()` running under copy A
// is invisible to `getCreationContext()` running under copy B, and the
// throw-on-missing-context fires.
const defineContext = getOrInstallGlobal(
    "@grest-ts/config:creation-context",
    () => new AsyncLocalStorage<GGConfigKeyCreationContext>(),
);

export class GGConfig {

    public static define<T>(name: string, define: () => T): GGConfigDefinition<T> {
        const keysMap: Map<ConstructorOf<GGConfigKey>, GGConfigKey[]> = new Map()
        const ctx: GGConfigKeyCreationContext = Object.freeze({
            name,
            add: (key: GGConfigKey) => {
                const cls = key.constructor as ConstructorOf<GGConfigKey>;
                if (!keysMap.has(cls)) {
                    keysMap.set(cls, [])
                }
                keysMap.get(cls).push(key)
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