import type {GGContext} from "./GGContext";
import {BrowserAsyncStorage, getOrInstallGlobal, setGlobal, type IAsyncStorage} from "@grest-ts/common";

// The actual storage instance lives on globalThis under a Symbol.for() slot.
// This makes the singleton survive duplicate module loads (bundled copy vs.
// node_modules copy, pnpm strict isolation, etc.) — every copy of this
// module routes through one shared instance instead of each holding its own.
const STORAGE_KEY = "@grest-ts/context:storage";

function resolveStorage(): IAsyncStorage<GGContext> {
    return getOrInstallGlobal(STORAGE_KEY, () => new BrowserAsyncStorage<GGContext>());
}

// Browser-safe by default. Node.js entry replaces with real AsyncLocalStorage
// via _initContextStorage. Reads always go through globalThis, so all copies
// of the module share one storage no matter which one called _init.
export const GG_CONTEXT_STORAGE: IAsyncStorage<GGContext> = new Proxy({} as IAsyncStorage<GGContext>, {
    get(_target, prop) {
        const real = resolveStorage();
        const value = (real as unknown as Record<PropertyKey, unknown>)[prop];
        return typeof value === "function" ? (value as Function).bind(real) : value;
    },
});

export function _initContextStorage(storage: IAsyncStorage<GGContext>): void {
    // Idempotent across copies: only the first node entry to load installs a
    // real storage. Later callers (e.g. a duplicate copy) leave it alone so
    // we don't shadow the live ALS that already has running contexts.
    setGlobal(STORAGE_KEY, storage, existing => !existing || existing instanceof BrowserAsyncStorage);
}
