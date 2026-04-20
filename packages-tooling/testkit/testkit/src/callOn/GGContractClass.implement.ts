/**
 * Patches GGContractClass.implement() to auto-register contract instances in GGLocator.
 *
 * This enables callOn(ContractClass) to work without each protocol (HTTP, WebSocket, etc.)
 * needing to manually register the contract instance.
 */

import {GGContractClass} from "@grest-ts/schema";
import {GGLocator, GGLocatorKey} from "@grest-ts/locator";

// Store the original implement method
const originalImplement = GGContractClass.prototype.implement;

export const LOCATOR_KEY_PREFIX_FOR_CONTRACT = "@contract:"

/**
 * Patched implement() that registers the returned client in GGLocator.
 *
 * The first implementation for a given contract name wins for `callOn(Contract)`
 * lookups. Subsequent `implement()` calls for the same contract are allowed
 * (WebSocket's startServer re-implements per incoming connection) and simply
 * return their own client without clobbering the registered one.
 */
GGContractClass.prototype.implement = function (
    this: GGContractClass<any>,
    instance: any,
    options?: any
) {
    const contractName = this.name;

    // Get the client from original implement
    const client = originalImplement.call(this, instance, options);

    // Register in GGLocator for callOn(Contract) access — first-wins
    const scope = GGLocator.tryGetScope();
    if (scope) {
        const key = new GGLocatorKey<typeof client>(LOCATOR_KEY_PREFIX_FOR_CONTRACT + contractName);
        if (!scope.has(key)) {
            scope.set(key, client);
        }
    }

    return client;
};
