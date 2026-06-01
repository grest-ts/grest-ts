import {GGContextKey, GGInbound, GGOutbound} from "@grest-ts/context";
import {IsBearerToken, NOT_AUTHORIZED} from "@grest-ts/schema";
import {IsUserAuthToken, tUserAuthToken} from "../Brands";

export class UserAuthHeader extends GGContextKey<tUserAuthToken> {

    public readonly headers = {
        "authorization": IsBearerToken.docs({title: "User auth token", description: "Bearer token for the authenticated user"})
    } as const;

    public readonly responseHeaders: Record<string, never> = {};

    update(outbound: GGOutbound): void {
        const token = GG_USER_AUTH.get();
        if (token) {
            outbound.headers["authorization"] = token;
        }
    }

    parse(inbound: GGInbound): void {
        const authHeader = inbound.headers['authorization'];
        if (!authHeader) {
            throw new NOT_AUTHORIZED({displayMessage: "Invalid authorization header!"});
        }
        GG_USER_AUTH.set(authHeader as tUserAuthToken);
    }

}

export const GG_USER_AUTH = new UserAuthHeader('realestate-user', IsUserAuthToken);
