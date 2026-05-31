import {GGRpc, GGHeader, httpSchema} from "@grest-ts/http"
import {FORBIDDEN, GGContractClass, GG_NO_PERMISSIONS, IsArray, IsEnum, IsObject, IsString, NOT_AUTHORIZED, SERVER_ERROR} from "@grest-ts/schema"

export enum WirePermission {
    ADMIN = "WIRE_ADMIN",
}
export const IsWirePermission = IsEnum(WirePermission)

export const IsWireUser = IsObject({
    id: IsString,
    username: IsString,
    permissions: IsArray(IsWirePermission),
})
export type WireUser = typeof IsWireUser.infer

// Smart wire: `Authorization: Bearer <token>`. Ephemeral — the raw token is readable only
// inside the server handler's process(), then cleared before the handler runs.
export const USER_TOKEN_WIRE = new GGHeader("authorization", {scheme: "bearer", permissions: IsWirePermission})

export const WireUserApiContract = new GGContractClass("WireUserApi", {
    me: {
        success: IsWireUser,
        errors: [NOT_AUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
    adminOnly: {
        success: IsString,
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
        permission: WirePermission.ADMIN,
    },
    // Returns the raw wire value as seen by the handler — proves the credential is cleared
    // after process() (a handler reads undefined, never the token).
    echoToken: {
        success: IsString,
        errors: [NOT_AUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
})

export const WireUserApi = httpSchema(WireUserApiContract)
    .pathPrefix("api/wire-user")
    .use(USER_TOKEN_WIRE)
    .routes({
        me: GGRpc.GET("me"),
        adminOnly: GGRpc.GET("admin"),
        echoToken: GGRpc.GET("echo"),
    })

export const WirePublicApiContract = new GGContractClass("WirePublicApi", {
    ping: {
        success: IsString,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
})

export const WirePublicApi = httpSchema(WirePublicApiContract)
    .pathPrefix("api/wire-public")
    .routes({
        ping: GGRpc.GET("ping"),
    })
