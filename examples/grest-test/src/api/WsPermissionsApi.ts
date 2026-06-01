import {
    defineSocketContract,
    webSocketSchema,
} from "@grest-ts/websocket"
import {
    FORBIDDEN,
    GG_NO_PERMISSIONS,
    GGContractClient,
    GGContractImplementation,
    IsString,
    NOT_AUTHORIZED,
    SERVER_ERROR,
} from "@grest-ts/schema"
import {AppPermission, TEST_RESOLVER_THROW_SCOPE, TEST_SCOPES_WIRE} from "./PermissionsApi"

/** See PermissionsApi.TEST_RESOLVER_THROW_SCOPE — same sentinel, reused for WS. */
export const WS_TEST_RESOLVER_THROW_SCOPE = TEST_RESOLVER_THROW_SCOPE

// ---- Contract: a multiplex socket (no connectPermission). ----
export const WsPermissionsApiContract = defineSocketContract("WsPermissionsApi", {
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

export const WsPermissionsApi = webSocketSchema(WsPermissionsApiContract)
    .path("ws/permissions-test")
    .use(TEST_SCOPES_WIRE)
    .done()

// ---- A second contract gated AT THE CONNECTION LEVEL. ----
export const WsFeaturePermissionsApiContract = defineSocketContract("WsFeaturePermissionsApi", {
    clientToServer: {
        ping: {
            success: IsString,
            errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
            permission: AppPermission.Read,
        },
    },
    serverToClient: {},
})

export const WsFeaturePermissionsApi = webSocketSchema(WsFeaturePermissionsApiContract)
    .path("ws/feature-permissions-test")
    .use(TEST_SCOPES_WIRE)
    .connectPermission(AppPermission.Admin)
    .done()

export type WsPermissionsIncoming = GGContractImplementation<typeof WsPermissionsApiContract.methods["clientToServer"]>
export type WsPermissionsOutgoing = GGContractClient<typeof WsPermissionsApiContract.methods["serverToClient"]>
export type WsFeatureIncoming = GGContractImplementation<typeof WsFeaturePermissionsApiContract.methods["clientToServer"]>
export type WsFeatureOutgoing = GGContractClient<typeof WsFeaturePermissionsApiContract.methods["serverToClient"]>
