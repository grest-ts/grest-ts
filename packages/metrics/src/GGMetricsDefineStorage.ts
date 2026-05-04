import {BrowserAsyncStorage, getOrInstallGlobal, setGlobal, type IAsyncStorage} from "@grest-ts/common";

const STORAGE_KEY = "@grest-ts/metrics:define-context";

function resolveStorage(): IAsyncStorage<string> {
    return getOrInstallGlobal(STORAGE_KEY, () => new BrowserAsyncStorage<string>());
}

// See @grest-ts/context GGContextStorage for why this is a Proxy backed by
// globalThis: survives duplicate module loads.
export const METRICS_DEFINE_CONTEXT: IAsyncStorage<string> = new Proxy({} as IAsyncStorage<string>, {
    get(_target, prop) {
        const real = resolveStorage();
        const value = (real as unknown as Record<PropertyKey, unknown>)[prop];
        return typeof value === "function" ? (value as Function).bind(real) : value;
    },
});

export function _initMetricsStorage(storage: IAsyncStorage<string>): void {
    setGlobal(STORAGE_KEY, storage, existing => !existing || existing instanceof BrowserAsyncStorage);
}
