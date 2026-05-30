import {GGInbound, GGOutbound, GGTransportMiddleware} from "@grest-ts/context"
import {GGLocatorKey} from "@grest-ts/locator";
import {Brand, IsBearerToken} from "@grest-ts/schema";

/**
 * Internal service auth token type
 */
export type tInternalAuthToken = string & Brand<"InternalAuthToken">

export const GG_INTERNAL_AUTH_TOKEN = new GGLocatorKey<tInternalAuthToken>('internal');

/**
 * Internal auth use for service-to-service communication.
 * Validates service token and trusts user headers from parent service.
 * Uses noValidation=true so no handler is required.
 */
export const InternalAuthUse: GGTransportMiddleware = {

    headers: {
        "authorization": IsBearerToken.docs({
            description: "Bearer token for service-to-service authentication",
            example: "Bearer internal_auth_token"
        })
    },
    responseHeaders: {},

    update(outbound: GGOutbound): void {
        const internal = GG_INTERNAL_AUTH_TOKEN.tryGet();
        if (internal) {
            outbound.headers["authorization"] = `Bearer ${internal}`;
        }
    },

    parse(inbound: GGInbound): void {
        const authHeader = inbound.headers['authorization'];
        if (!authHeader || typeof authHeader !== 'string') {
            throw new Error('No authorization header');
        }
        if (!authHeader.startsWith('Bearer ')) {
            throw new Error('Invalid authorization header format');
        }
        const internal = authHeader.substring(7) as tInternalAuthToken;
        GG_INTERNAL_AUTH_TOKEN.overwrite(internal);
    }
}
