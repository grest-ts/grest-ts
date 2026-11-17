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

const registered = new WeakMap<object, {contract: GGContractClass<any>, instance: unknown}>()

/**
 * Patched implement() that registers the returned client in GGLocator.
 *
 * Strict by default: registering the same contract name twice is an error, unless it's
 * the same contract and implementation served again (two schemas of one contract, at two path prefixes).
 * Transports that produce per-connection or per-client impls (WebSocket's
 * startServer, HTTP's createClient) pass `{skipLocatorRegistration: true}`
 * in options to opt out — those impls have no business in the callOn registry.
 */
GGContractClass.prototype.implement = function (
    this: GGContractClass<any>,
    instance: any,
    options?: any
) {
    const contractName = this.name;

    // Get the client from original implement
    const client = originalImplement.call(this, instance, options);

    if (options?.skipLocatorRegistration) {
        return client;
    }

    // Register in GGLocator for callOn(Contract) access — strict, throws on duplicate
    const scope = GGLocator.tryGetScope();
    if (scope) {
        const key = new GGLocatorKey<typeof client>(LOCATOR_KEY_PREFIX_FOR_CONTRACT + contractName);
        if (scope.has(key)) {
            const prior = registered.get(scope.get(key));
            if (prior?.contract === this && prior.instance === instance) return client;
            throw new Error(
                `Contract '${contractName}' is already registered in this scope. ` +
                `If this is an internal per-connection implement (e.g. WebSocket server handler) ` +
                `pass {skipLocatorRegistration: true}. Otherwise, use different contract names.`
            );
        }
        scope.set(key, client);
        registered.set(client, {contract: this, instance});
    }

    return client;
};
