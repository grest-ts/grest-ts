import {GGLocator, GGLocatorKey} from "@grest-ts/locator";
import {GGInstanceLock, GGInstanceLockEntry} from "../instance/GGInstanceLock";

export const GGContextLockStorageKey = new GGLocatorKey<Map<string, GGInstanceLockEntry>>("GGLocatorScopeLock");

/**
 * In-memory lock scoped to the current `GGLocatorScope`: each scope has its own, isolated lock state (e.g. one per
 * test). Throws outside a scope.
 */
export class GGLocatorScopeLock extends GGInstanceLock {

    protected override storage(): Map<string, GGInstanceLockEntry> {
        const scope = GGLocator.getScope();
        let storage = scope.tryGet(GGContextLockStorageKey);
        if (!storage) {
            storage = new Map();
            scope.set(GGContextLockStorageKey, storage);
        }
        return storage;
    }
}
