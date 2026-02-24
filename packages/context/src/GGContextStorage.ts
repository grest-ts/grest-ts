import type {GGContext} from "./GGContext";
import {BrowserAsyncStorage, type IAsyncStorage} from "@grest-ts/common";

// Browser-safe by default. Node.js entry replaces with real AsyncLocalStorage.
export let GG_CONTEXT_STORAGE: IAsyncStorage<GGContext> = new BrowserAsyncStorage();

export function _initContextStorage(storage: IAsyncStorage<GGContext>): void {
    GG_CONTEXT_STORAGE = storage;
}
