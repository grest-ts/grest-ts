/**
 * Node store for GGLog: the active logger lives in the locator scope, alongside
 * everything else a runtime registers, giving per-runtime/per-request isolation.
 * Imported only from the node entry, so @grest-ts/locator (node-only) stays out
 * of the browser bundle.
 */
import {GGLocator, GGLocatorKey, GGLocatorScope} from "@grest-ts/locator";
import {GGLog, _setGGLogStore} from "./GGLog";

const GG_LOG_KEY = new GGLocatorKey<GGLog>("GGLog");

_setGGLogStore({
    get: () => GG_LOG_KEY.get(),
    tryGet: () => GG_LOG_KEY.tryGet(),
    set: (instance, scope) => ((scope as GGLocatorScope | undefined) ?? GGLocator.getScope()).set(GG_LOG_KEY, instance),
});
