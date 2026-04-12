import {GGHttpRequest, GGHttpTransportMiddleware} from "@grest-ts/http"
import {GGLocatorKey} from "@grest-ts/locator";
import {Brand, IsString} from "@grest-ts/schema";

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
export const InternalAuthUse: GGHttpTransportMiddleware = {

    headers: {
        "authorization": IsString.nonEmpty.docs({
            title: "Internal service token",
            description: "Bearer token for service-to-service authentication",
            example: "Bearer internal_auth_token"
        })
    },
    responseHeaders: {},

    updateRequest(req: GGHttpRequest): void {
        const internal = GG_INTERNAL_AUTH_TOKEN.tryGet();
        if (internal) {
            req.headers["authorization"] = `Bearer ${internal}`;
        }
    },

    parseRequest(req: { headers: Record<string, string | string[]> }): void {
        const authHeader = req.headers['authorization'];
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
