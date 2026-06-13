/**
 * Node store for GGIntl: the active i18n service lives in the locator scope
 * with GGRuntime-driven start/teardown lifecycle. Imported only from the node
 * entry, so @grest-ts/locator (node-only) stays out of the browser bundle.
 */
import {GGLocator, GGLocatorKey, GGLocatorServiceType} from "@grest-ts/locator";
import type {GGIntl} from "./GGIntl";
import {_setGGIntlStore} from "./GG_INTL";

const GG_INTL_KEY = new GGLocatorKey<GGIntl>("GG_INTL");

_setGGIntlStore({
    get: () => GG_INTL_KEY.get(),
    tryGet: () => GG_INTL_KEY.tryGet(),
    register: (instance, lifecycle) => GGLocator.getScope().setWithLifecycle(GG_INTL_KEY, instance, {
        type: GGLocatorServiceType.INTL,
        start: lifecycle.start,
        teardown: lifecycle.teardown,
    }),
});
