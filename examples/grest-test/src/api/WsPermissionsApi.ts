import {
    GGWebSocketSchema,
} from "@grest-ts/websocket"
import {
    FORBIDDEN,
    GG_NO_PERMISSIONS,
    GGDuplexContract,
    IsString,
    NOT_AUTHORIZED,
    SERVER_ERROR,
} from "@grest-ts/schema"
import {AppPermission, TEST_RESOLVER_THROW_SCOPE, TEST_SCOPES_WIRE} from "./PermissionsApi"

/** See PermissionsApi.TEST_RESOLVER_THROW_SCOPE — same sentinel, reused for WS. */
export const WS_TEST_RESOLVER_THROW_SCOPE = TEST_RESOLVER_THROW_SCOPE

// ---- Contract: a multiplex socket (no connect permission). ----
export const WsPermissionsApiContract = new GGDuplexContract("WsPermissionsApi", {
    connect: {errors: [SERVER_ERROR]},
    clientToServer: {
        publicMessage: {
            input: IsString,
            success: IsString,
            errors: [SERVER_ERROR],
            permission: GG_NO_PERMISSIONS,
        },
        needsRead: {
            input: IsString,
            success: IsString,
            errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
            permission: AppPermission.Read,
        },
        needsAllReadWrite: {
            input: IsString,
            success: IsString,
            errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
            permission: {allOf: [AppPermission.Read, AppPermission.Write]},
        },
        needsAnyReadOrAdmin: {
            input: IsString,
            success: IsString,
            errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
            permission: {anyOf: [AppPermission.Read, AppPermission.Admin]},
        },
    },
    serverToClient: {
        // s2c carries permission field per the simplified type plumbing (gate
        // ignores it — server originates). Convention: GG_NO_PERMISSIONS.
        echo: {
            input: IsString,
            permission: GG_NO_PERMISSIONS,
        },
    },
})

export const WsPermissionsApi = new GGWebSocketSchema({
    contract: WsPermissionsApiContract,
    path: "ws/permissions-test",
    use: [TEST_SCOPES_WIRE],
})

// ---- A second contract gated AT THE CONNECTION LEVEL. ----
export const WsFeaturePermissionsApiContract = new GGDuplexContract("WsFeaturePermissionsApi", {
    connect: {
        permission: AppPermission.Admin,
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
    },
    clientToServer: {
        ping: {
            success: IsString,
            errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
            permission: AppPermission.Read,
        },
    },
    serverToClient: {},
})

export const WsFeaturePermissionsApi = new GGWebSocketSchema({
    contract: WsFeaturePermissionsApiContract,
    path: "ws/feature-permissions-test",
    use: [TEST_SCOPES_WIRE],
})
