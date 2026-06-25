/**
 * CALL_ON_FACTORY implementation for GGHttpSchema.
 *
 * Enables callOn(HttpApi) to work by providing HTTP transport.
 * Returns properly typed GGHttpCall for each contract method.
 */

import {GGContractApiDefinition, GGContractMethod, GGContractMethodErrors, GGSchema, Raw, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema";
import {GGHttpCall} from "./GGHttpCall";
import {GGContext} from "@grest-ts/context";
import {GGHttpSchema} from "../../src/schema/GGHttpSchema";
import {CALL_ON_FACTORY, GGCallOnFactory} from "@grest-ts/testkit";
import {createClient} from "../../src/client/GGHttpSchema.createClient";

/**
 * Maps contract methods with input to GGHttpCall.
 */
type HttpCallWithInput<TContract extends Record<string, GGContractMethod>> = {
    [K in keyof TContract as TContract[K] extends { input: GGSchema<any> } ? K : never]:
    (data: Raw<NonNullable<TContract[K]['input']>['infer']>) => GGHttpCall<NonNullable<TContract[K]['input']>['infer'], NonNullable<TContract[K]['success']>['infer'], GGContractMethodErrors<TContract[K]> | typeof SERVER_ERROR.infer | typeof VALIDATION_ERROR.infer>
}

/**
 * Maps contract methods without input to GGHttpCall.
 */
type HttpCallWithoutInput<TContract extends Record<string, GGContractMethod>> = {
    [K in keyof TContract as TContract[K] extends { input: GGSchema<any> } ? never : K]:
    () => GGHttpCall<void, NonNullable<TContract[K]['success']>['infer'], GGContractMethodErrors<TContract[K]> | typeof SERVER_ERROR.infer>
}

/**
 * Full HTTP call map for a contract - all methods return GGHttpCall.
 */
export type GGHttpCallMap<TContract extends Record<string, GGContractMethod>> =
    HttpCallWithInput<TContract> & HttpCallWithoutInput<TContract>;

declare module "../../src/schema/GGHttpSchema" {
    interface GGHttpSchema<TContract extends GGContractApiDefinition> extends GGCallOnFactory {
        [CALL_ON_FACTORY](ctx: GGContext): GGHttpCallMap<TContract>;
    }
}

const classCache: WeakMap<any, any> = new WeakMap();

GGHttpSchema.prototype[CALL_ON_FACTORY] = function <TContract extends GGContractApiDefinition>(this: GGHttpSchema<TContract>, ctx: GGContext): GGHttpCallMap<TContract> {
    if (!classCache.has(this)) {
        classCache.set(this, createClient(this, {noValidation: true}));
    }
    const contractClient = classCache.get(this)!;
    return new Proxy({} as GGHttpCallMap<TContract>, {
        get(_, methodName: string) {
            const contractMethod = contractClient[methodName];
            if (typeof contractMethod === 'function') {
                return (data?: any) => new GGHttpCall(ctx, methodName, data, contractMethod);
            } else {
                return undefined;
            }
        }
    });
};
