import {AsyncLocalStorage} from "node:async_hooks";
import {_initLocatorStorage} from "./GGLocatorStorage";
_initLocatorStorage(new AsyncLocalStorage());

export {GGLocatorScope, GGLocatorServiceType} from "./GGLocatorScope";
export type {GGLocatorLifecycleCallbacks} from "./GGLocatorScope";
export {GGLocatorKey} from "./GGLocatorKey";
export {GGLocator} from "./GGLocator";
