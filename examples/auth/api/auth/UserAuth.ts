import {GGHeader} from "@grest-ts/http"
import {GGContextKey} from "@grest-ts/context"
import {IsEnum, IsObject, IsString} from "@grest-ts/schema"

// Permissions this wire can grant. Strings must be globally unique across all wires —
// a duplicate against another wire is a startup crash (Rule 6).
export enum UserPermission {
    CAN_UPDATE_RED_BANNER_COUNTER = "CAN_UPDATE_RED_BANNER_COUNTER",
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

// SMART wire: parses `Authorization: Bearer <jwt>`. Ephemeral — the raw token is readable
// only inside the server handler's process(), then cleared before the handler runs. Owns the
// UserPermission set (used for routing per-method `permission` + startup validation).
// Server behaviour is attached once via .define() (see server/auth/UserAuthHandler.ts);
// the client value/refresh via .defineClient() (see client/src/auth.ts).
export const USER_TOKEN_WIRE = new GGHeader("authorization", {scheme: "bearer", permissions: IsUserPermission})

// DURABLE identity the wire produces. Handlers read this; they never see the raw token.
export const USER_DATA = new GGContextKey<User>("userData", IsUser)
