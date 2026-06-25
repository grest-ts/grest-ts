import {GGRpc, GGHeader, httpSchema, GGHttpSchema} from "@grest-ts/http"
import {defineSocketContract, GGWebSocketSchema, webSocketSchema} from "@grest-ts/websocket"
import {FORBIDDEN, GGContractClass, GGContractClient, GGContractImplementation, GG_NO_PERMISSIONS, IsArray, IsEnum, IsObject, IsString, NOT_AUTHORIZED, SERVER_ERROR, GGDuplexContract} from "@grest-ts/schema"
import {enumOf, type Values} from "@grest-ts/common"

export const WirePermission = enumOf({
    ADMIN: "WIRE_ADMIN",
})
export type WirePermission = Values<typeof WirePermission>
export const IsWirePermission = IsEnum(WirePermission)

export const IsWireUser = IsObject({
    id: IsString,
    username: IsString,
    permissions: IsArray(IsWirePermission),
})
export type WireUser = typeof IsWireUser.infer

// Smart wire: `Authorization: Bearer <token>`. Ephemeral — the raw token is readable only
// inside the server handler's process(), then cleared before the handler runs.
export const USER_TOKEN_WIRE = new GGHeader("authorization", {scheme: "bearer"})

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

export const WireUserApi = new GGHttpSchema({
    contract: WireUserApiContract,
    pathPrefix: "api/wire-user",
    use: [USER_TOKEN_WIRE],
    routes: {
        me: GGRpc.GET("me"),
        adminOnly: GGRpc.GET("admin"),
        echoToken: GGRpc.GET("echo"),
    }
})

export const WirePublicApiContract = new GGContractClass("WirePublicApi", {
    ping: {
        success: IsString,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
})

export const WirePublicApi = new GGHttpSchema({
    contract: WirePublicApiContract,
    pathPrefix: "api/wire-public",
    routes: {
        ping: GGRpc.GET("ping"),
    }
})

// ---- second wire (org-like), for multi-wire AND-across-sources -------------------------------
export const OrgWirePermission = enumOf({
    ORG_MEMBER: "WIRE_ORG_MEMBER",
})
export type OrgWirePermission = Values<typeof OrgWirePermission>
export const IsOrgWirePermission = IsEnum(OrgWirePermission)

export const ORG_TOKEN_WIRE = new GGHeader("x-org-token", {})

export const WireOrgScopedApiContract = new GGContractClass("WireOrgScopedApi", {
    // Requires the org membership permission (from ORG_TOKEN_WIRE); the user wire still authenticates.
    orgInfo: {
        success: IsString,
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
        permission: OrgWirePermission.ORG_MEMBER,
    },
})

export const WireOrgScopedApi = new GGHttpSchema({
    contract: WireOrgScopedApiContract,
    pathPrefix: "api/wire-org-scoped",
    use: [USER_TOKEN_WIRE, ORG_TOKEN_WIRE],
    routes: {
        orgInfo: GGRpc.GET("info"),
    }
})

// ---- WebSocket smart-wire schema: the user wire authenticates at handshake; per-message gate ----
export const WireLiveApiContract = new GGDuplexContract("WireLiveApi", {
    connect: {
        errors: [NOT_AUTHORIZED, SERVER_ERROR],
    },
    clientToServer: {
        // Anyone authenticated (the wire is required-or-throw at handshake) can call.
        whoami: {success: IsString, errors: [NOT_AUTHORIZED, SERVER_ERROR], permission: GG_NO_PERMISSIONS},
        // Per-message gate: needs the user wire's ADMIN permission.
        adminPing: {success: IsString, errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR], permission: WirePermission.ADMIN},
    },
    serverToClient: {},
})

export const WireLiveApi = new GGWebSocketSchema({
    contract: WireLiveApiContract,
    path: "api/wire-live",
    use: [USER_TOKEN_WIRE],
})

export type WireLiveIncoming = GGContractImplementation<typeof WireLiveApiContract["clientToServer"]>
export type WireLiveOutgoing = GGContractClient<typeof WireLiveApiContract["serverToClient"]>
