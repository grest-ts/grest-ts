import {
    GGSocketContractMethods,
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
const WsPermissionsApiMethods = {
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
} satisfies GGSocketContractMethods

export const WsPermissionsApi = webSocketSchema("WsPermissionsApi")
    .path("ws/permissions-test")
    .use(TEST_SCOPES_WIRE)
    .messages(WsPermissionsApiMethods)

// ---- A second contract gated AT THE CONNECTION LEVEL. ----
const WsFeaturePermissionsApiMethods = {
    clientToServer: {
        ping: {
            success: IsString,
            errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
            permission: AppPermission.Read,
        },
    },
    serverToClient: {},
} satisfies GGSocketContractMethods

export const WsFeaturePermissionsApi = webSocketSchema("WsFeaturePermissionsApi")
    .path("ws/feature-permissions-test")
    .use(TEST_SCOPES_WIRE)
    .connectPermission(AppPermission.Admin)
    .messages(WsFeaturePermissionsApiMethods)

export type WsPermissionsIncoming = GGContractImplementation<typeof WsPermissionsApiMethods["clientToServer"]>
export type WsPermissionsOutgoing = GGContractClient<typeof WsPermissionsApiMethods["serverToClient"]>
export type WsFeatureIncoming = GGContractImplementation<typeof WsFeaturePermissionsApiMethods["clientToServer"]>
export type WsFeatureOutgoing = GGContractClient<typeof WsFeaturePermissionsApiMethods["serverToClient"]>
