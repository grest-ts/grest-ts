import type {GGIntl} from "./GGIntl";

/**
 * Holds the active GGIntl instance for the current execution context. On the
 * server GGIntlStore.node backs this with the locator scope (per-runtime
 * isolation + GGRuntime-driven start/teardown); the browser default below is a
 * plain module singleton — one i18n config per page, no async-context or
 * lifecycle machinery — so @grest-ts/locator (a node-only DI / async-context
 * package) never reaches the browser bundle.
 */
export interface GGIntlLifecycle {
    start: () => Promise<void>;
    teardown: () => Promise<void>;
}

export interface GGIntlStore {
    get(): GGIntl;
    tryGet(): GGIntl | undefined;
    /** Register the instance as active. The server store wires it into the
     *  locator scope with the lifecycle; the browser store just holds it (the
     *  app drives start() itself). */
    register(instance: GGIntl, lifecycle: GGIntlLifecycle): void;
}

let browserInstance: GGIntl | undefined;
let store: GGIntlStore = {
    get(): GGIntl {
        if (!browserInstance) throw new Error("GGIntl not initialized — construct a GGIntl instance first");
        return browserInstance;
    },
    tryGet: () => browserInstance,
    register: (instance) => { browserInstance = instance; },
};

/** Install a different backing store. GGIntlStore.node calls this to switch to
 *  locator-scoped resolution; not for app code. */
export function _setGGIntlStore(s: GGIntlStore): void {
    store = s;
}

/** Used by GGIntl's constructor to register itself as the active instance. */
export function _registerGGIntl(instance: GGIntl, lifecycle: GGIntlLifecycle): void {
    store.register(instance, lifecycle);
}

/** The active GGIntl instance. Shape kept from the former locator key so every
 *  `GG_INTL.get()` / `GG_INTL.tryGet()` callsite is unchanged. */
export const GG_INTL = {
    get: (): GGIntl => store.get(),
    tryGet: (): GGIntl | undefined => store.tryGet(),
};
