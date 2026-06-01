import {GGSchema, IsBearerToken, IsObject, IsString, NOT_AUTHORIZED} from "@grest-ts/schema";
import {GGContextKey, GGInbound, GGOutbound} from "@grest-ts/context";

export const IsUserAuthToken = IsString.brand("UserAuthToken");
export type tUserAuthToken = typeof IsUserAuthToken.infer

export const IsUserId = IsString.brand("UserId");
export type tUserId = typeof IsUserId.infer

export const IsUser = IsObject({
    id: IsUserId,
    username: IsString,
    email: IsString
})
export type User = typeof IsUser.infer

export class UserAuth extends GGContextKey<tUserAuthToken> {

    readonly headers: Record<string, GGSchema<string | undefined>> = {
        "authorization": IsBearerToken.docs({
            description: "JWT bearer token for user authentication",
            example: "Bearer eyJhbGciOiJIUzI1NiJ9..."
        })
    };
    readonly responseHeaders: Record<string, GGSchema<string | undefined>> = {};

    update(outbound: GGOutbound): void {
        const user = GG_USER_AUTH_TOKEN.get();
        if (user) {
            outbound.headers["authorization"] = `Bearer ${user}`;
        }
    }

    parse(inbound: GGInbound): void {
        const authHeader = inbound.headers['authorization'];
        if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
            throw new NOT_AUTHORIZED({displayMessage: "Invalid authorization header!"});
        }
        GG_USER_AUTH_TOKEN.set(authHeader.substring(7) as tUserAuthToken);
    }

}

export const GG_USER_AUTH_TOKEN = new UserAuth('user', IsUserAuthToken);
