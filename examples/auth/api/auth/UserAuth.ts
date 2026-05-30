import {GGHeader} from "@grest-ts/http"
import {GGContextKey} from "@grest-ts/context"
import {IsEnum, IsObject, IsString} from "@grest-ts/schema"

// Raw token context key — populated by USER_TOKEN_WIRE when parsing the Authorization header.
// Pass to AuthGuard; in tests use this.set(USER_TOKEN, accessToken).
export const USER_TOKEN = new GGContextKey<string | undefined>("user", IsString.orUndefined)

// Wire binding — attach to API schemas with .use(USER_TOKEN_WIRE).
// Parses Authorization: Bearer <token> on HTTP and WS upgrade.
export const USER_TOKEN_WIRE = GGHeader.middleware(USER_TOKEN, {name: "authorization", scheme: "bearer"})

// Permissions embedded in the user JWT at issue time.
export enum UserPermission {
    CAN_SEE_RED_BANNER = "CAN_SEE_RED_BANNER",
}
export const IsUserPermission = IsEnum(UserPermission)

export const IsUserId = IsString.brand("UserId")
export type tUserId = typeof IsUserId.infer

export const IsUser = IsObject({
    id: IsUserId,
    username: IsString,
    email: IsString,
})
export type User = typeof IsUser.infer

// Set by UserContextMiddleware after JWT verification. Read by handlers via UserContext.get().
export const UserContext = new GGContextKey<User>("userData", IsUser)
