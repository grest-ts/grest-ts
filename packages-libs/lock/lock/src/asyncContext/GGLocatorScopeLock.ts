import {GGLocator, GGLocatorKey} from "@grest-ts/locator";
import {GGInstanceLock} from "../instance/GGInstanceLock";

const STORAGE = new GGLocatorKey<Map<string, {owner: string, expiresAt: number}>>("GGLocatorScopeLock");

/** Lock state per `GGLocatorScope` (e.g. per test). Throws outside a scope. */
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
