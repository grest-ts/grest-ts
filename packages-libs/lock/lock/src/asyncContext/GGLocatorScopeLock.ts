import {GGLocator, GGLocatorKey} from "@grest-ts/locator";
import {GGInstanceLock} from "../instance/GGInstanceLock";

const STORAGE = new GGLocatorKey<Map<string, {owner: string, expiresAt: number}>>("GGLocatorScopeLock");

/**
 * In-memory lock scoped to the current `GGLocatorScope`: each scope has its own, isolated lock state (e.g. one per
 * test). Throws outside a scope.
 */
export class GGLocatorScopeLock extends GGInstanceLock {

    protected override storage(): Map<string, {owner: string, expiresAt: number}> {
        const scope = GGLocator.getScope();
        let storage = scope.tryGet(STORAGE);
        if (!storage) {
            storage = new Map();
            scope.set(STORAGE, storage);
        }
        return storage;
    }
}
