import {
    defineSocketContract,
    webSocketSchema,
} from "@grest-ts/websocket"
import {
    FORBIDDEN,
    GG_NO_PERMISSIONS,
    GGContractClient,
    GGContractImplementation,
    IsArray,
    IsString,
    NOT_AUTHORIZED,
    SERVER_ERROR,
} from "@grest-ts/schema"
import {GGContextKey, GGInbound, GGOutbound, GGTransportMiddleware} from "@grest-ts/context"
import {AppPermission} from "./PermissionsApi"

/**
 * Client-side: scopes the test wants to claim — sent via custom handshake header.
 */
export const WS_CLIENT_SCOPES = new GGContextKey<string[]>("wsClientScopes", IsArray(IsString))

/**
 * Server-side: scopes parsed from the handshake header (cached by the gate
 * for the lifetime of the connection).
 */
export const WS_SERVER_SCOPES = new GGContextKey<string[]>("wsServerScopes", IsArray(IsString))

export const WsTestAuthMiddleware: GGTransportMiddleware = {
    // Client → puts scopes header on the handshake message.
    update(outbound: GGOutbound): void {
        const scopes = WS_CLIENT_SCOPES.get()
        if (scopes && scopes.length > 0) {
            outbound.headers["x-test-scopes"] = scopes.join(",")
        }
    },
    // Server → reads the header, populates WS_SERVER_SCOPES.
    parse(inbound: GGInbound): void {
        const raw = inbound.headers["x-test-scopes"]
        if (typeof raw === "string" && raw.length > 0) {
            WS_SERVER_SCOPES.set(raw.split(",").map(s => s.trim()).filter(Boolean))
        }
    },
}

/** See PermissionsApi.TEST_RESOLVER_THROW_SCOPE — same sentinel, WS variant. */
export const WS_TEST_RESOLVER_THROW_SCOPE = "__test:throw__"

export const getWsTestScopes = (): ReadonlySet<string> | null => {
    const scopes = WS_SERVER_SCOPES.get()
    if (!scopes) return null
    if (scopes.includes(WS_TEST_RESOLVER_THROW_SCOPE)) throw new Error("ws resolver intentionally threw — test signal")
    return new Set(scopes)
}

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
    .use(WsTestAuthMiddleware)
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
    .use(WsTestAuthMiddleware)
    .connectPermission(AppPermission.Admin)
    .done()

export type WsPermissionsIncoming = GGContractImplementation<typeof WsPermissionsApiContract.methods["clientToServer"]>
export type WsPermissionsOutgoing = GGContractClient<typeof WsPermissionsApiContract.methods["serverToClient"]>
export type WsFeatureIncoming = GGContractImplementation<typeof WsFeaturePermissionsApiContract.methods["clientToServer"]>
export type WsFeatureOutgoing = GGContractClient<typeof WsFeaturePermissionsApiContract.methods["serverToClient"]>
