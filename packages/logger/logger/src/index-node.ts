import "./_dedupCheck";
// Side-effect: installs the locator-scoped GGLog store (node-only). Must run
// before anything resolves GG_LOG so the server gets per-runtime isolation.
import "./GGLogStore.node";
export * from './GGLog';
export * from './GGLogger';
export * from './types';
export {type IAsyncLocalStorage, AsyncLocalStorageImpl} from './IAsyncLocalStorage'
