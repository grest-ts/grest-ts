import {BrowserAsyncStorage, type IAsyncStorage} from "@grest-ts/common";

// Browser-safe by default. Node.js entry replaces with real AsyncLocalStorage.
export let METRICS_DEFINE_CONTEXT: IAsyncStorage<string> = new BrowserAsyncStorage();

export function _initMetricsStorage(storage: IAsyncStorage<string>): void {
    METRICS_DEFINE_CONTEXT = storage;
}
