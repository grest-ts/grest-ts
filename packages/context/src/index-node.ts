import {AsyncLocalStorage} from "node:async_hooks";
import {_initContextStorage} from "./GGContextStorage";
_initContextStorage(new AsyncLocalStorage());

export * from "./GGContext";
export * from "./GGContextKey";
export * from "./GGContextStore";
