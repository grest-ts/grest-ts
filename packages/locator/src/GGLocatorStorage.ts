import type {GGLocatorScope} from "./GGLocatorScope";
import {BrowserAsyncStorage, getOrInstallGlobal, setGlobal, type IAsyncStorage} from "@grest-ts/common";

const STORAGE_KEY = "@grest-ts/locator:storage";

function resolveStorage(): IAsyncStorage<GGLocatorScope> {
    return getOrInstallGlobal(STORAGE_KEY, () => new BrowserAsyncStorage<GGLocatorScope>());
}

// See @grest-ts/context GGContextStorage for why this is a Proxy backed by
// globalThis: survives duplicate module loads.
export const GG_ASYNC_STORAGE: IAsyncStorage<GGLocatorScope> = new Proxy({} as IAsyncStorage<GGLocatorScope>, {
    get(_target, prop) {
        const real = resolveStorage();
        const value = (real as unknown as Record<PropertyKey, unknown>)[prop];
        return typeof value === "function" ? (value as Function).bind(real) : value;
    },
});

export function _initLocatorStorage(storage: IAsyncStorage<GGLocatorScope>): void {
    setGlobal(STORAGE_KEY, storage, existing => !existing || existing instanceof BrowserAsyncStorage);
}
