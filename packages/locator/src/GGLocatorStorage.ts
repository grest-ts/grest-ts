import type {GGLocatorScope} from "./GGLocatorScope";
import {BrowserAsyncStorage, type IAsyncStorage} from "@grest-ts/common";

// Browser-safe by default. Node.js entry replaces with real AsyncLocalStorage.
export let GG_ASYNC_STORAGE: IAsyncStorage<GGLocatorScope> = new BrowserAsyncStorage();

export function _initLocatorStorage(storage: IAsyncStorage<GGLocatorScope>): void {
    GG_ASYNC_STORAGE = storage;
}
