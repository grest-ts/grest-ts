import {GGHeader} from "@grest-ts/http"
import {IsArray, IsEnum, IsObject, IsString} from "@grest-ts/schema"

// Permissions a user can hold, carried on the durable principal.
export enum UserPermission {
    CAN_UPDATE_RED_BANNER_COUNTER = "CAN_UPDATE_RED_BANNER_COUNTER",
}
export const IsUserPermission = IsEnum(UserPermission)

export const IsUserId = IsString.brand("UserId")
export type tUserId = typeof IsUserId.infer

// The full user identity — returned to the client as the login/refresh response `data`, and
// re-fetched server-side as the durable principal. Carries profile fields (username, email)
// that per-request authorization never needs.
export const IsUser = IsObject({
    id: IsUserId,
    username: IsString,
    email: IsString,
    permissions: IsArray(IsUserPermission)
})
export type User = typeof IsUser.infer

// What actually rides inside the access token — the minimal authz-relevant subset. The token
// is sent on every request, so it carries only permissions, not the profile. The full identity
// is the response `data` / the re-fetched principal, never the token.
export const IsUserClaims = IsObject({
    permissions: IsArray(IsUserPermission)
})
export type UserClaims = typeof IsUserClaims.infer

// SMART wire: parses `Authorization: Bearer <jwt>`. Ephemeral — the raw token is readable
// only inside the server handler's process(), then cleared before the handler runs.
// Server behaviour is attached once via .define() (see server/auth/UserAuthHandler.ts);
// the client value/refresh via .defineClient() (see client/src/auth.ts).
export const USER_TOKEN_WIRE = new GGHeader("authorization", {scheme: "bearer"})
