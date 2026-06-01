import {GGHeader} from "@grest-ts/http"
import {IsArray, IsEnum, IsObject, IsString} from "@grest-ts/schema"

// Permissions a user can hold, carried on the durable principal.
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
    permissions: IsArray(IsUserPermission)
})
export type User = typeof IsUser.infer

// SMART wire: parses `Authorization: Bearer <jwt>`. Ephemeral — the raw token is readable
// only inside the server handler's process(), then cleared before the handler runs.
// Server behaviour is attached once via .define() (see server/auth/UserAuthHandler.ts);
// the client value/refresh via .defineClient() (see client/src/auth.ts).
export const USER_TOKEN_WIRE = new GGHeader("authorization", {scheme: "bearer"})
