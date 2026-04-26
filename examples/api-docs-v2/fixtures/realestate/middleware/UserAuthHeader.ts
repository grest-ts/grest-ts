import {GGContextKey} from "@grest-ts/context";
import {GGHttpRequest} from "@grest-ts/http";
import {IsBearerToken, IsString, NOT_AUTHORIZED} from "@grest-ts/schema";
import {IsUserAuthToken, tUserAuthToken} from "../Brands";

export class UserAuthHeader extends GGContextKey<tUserAuthToken> {

    // Required by current GGHttpTransportMiddleware shape — describes the headers
    // this middleware reads, used for OpenAPI / docs.
    public readonly headers = {
        "authorization": IsBearerToken.docs({title: "User auth token", description: "Bearer token for the authenticated user"})
    } as const;

    public readonly responseHeaders: Record<string, never> = {};

    updateRequest(req: GGHttpRequest): void {
        const token = GG_USER_AUTH.get();
        if (token) {
            req.headers["authorization"] = token;
        }
    }

    parseRequest(req: GGHttpRequest): void {
        const authHeader = req.headers['authorization'];
        if (!authHeader || typeof authHeader !== 'string') {
            throw new NOT_AUTHORIZED({displayMessage: "Invalid authorization header!"});
        }
        GG_USER_AUTH.set(authHeader as tUserAuthToken);
    }

}

export const GG_USER_AUTH = new UserAuthHeader('realestate-user', IsUserAuthToken);