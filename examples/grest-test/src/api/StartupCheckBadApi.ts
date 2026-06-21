import {GGRpc, httpSchema} from "@grest-ts/http"
import {
    GG_NO_PERMISSIONS,
    GGContractClass,
    IsString,
    SERVER_ERROR,
} from "@grest-ts/schema"
import {webSocketSchema} from "@grest-ts/websocket"

/**
 * Fixture: every method declared GG_NO_PERMISSIONS. Strict mode is triggered
 * (declarations exist), but every route satisfies it — start must succeed.
 */
export const StartupCheckAllPublicContract = new GGContractClass("StartupCheckAllPublic", {
    ping: {success: IsString, errors: [SERVER_ERROR], permission: GG_NO_PERMISSIONS},
    pong: {success: IsString, errors: [SERVER_ERROR], permission: GG_NO_PERMISSIONS},
})

export const StartupCheckAllPublicApi = httpSchema(StartupCheckAllPublicContract)
    .pathPrefix("api/startup-check-all-public")
    .routes({
        ping: GGRpc.GET("ping"),
        pong: GGRpc.GET("pong"),
    })

/**
 * Fixture: nothing declares a permission. No usePermissions wiring either.
 * Strict mode is NOT triggered — start must succeed silently.
 */
export const StartupCheckZeroConfigContract = new GGContractClass("StartupCheckZeroConfig", {
    hello: {success: IsString, errors: [SERVER_ERROR]},
    world: {success: IsString, errors: [SERVER_ERROR]},
})

export const StartupCheckZeroConfigApi = httpSchema(StartupCheckZeroConfigContract)
    .pathPrefix("api/startup-check-zero-config")
    .routes({
        hello: GGRpc.GET("hello"),
        world: GGRpc.GET("world"),
    })

/**
 * Fixture: one contract declares permissions, another does not. When mounted
 * on the same server, the first triggers strict mode and the second's
 * undeclared routes must fail the start.
 */
export const StartupCheckDeclaredContract = new GGContractClass("StartupCheckDeclared", {
    publicOne: {success: IsString, errors: [SERVER_ERROR], permission: GG_NO_PERMISSIONS},
})

export const StartupCheckDeclaredApi = httpSchema(StartupCheckDeclaredContract)
    .pathPrefix("api/startup-check-declared")
    .routes({
        publicOne: GGRpc.GET("public"),
    })

export const StartupCheckUndeclaredContract = new GGContractClass("StartupCheckUndeclared", {
    forgotten: {success: IsString, errors: [SERVER_ERROR]},
})

export const StartupCheckUndeclaredApi = httpSchema(StartupCheckUndeclaredContract)
    .pathPrefix("api/startup-check-undeclared")
    .routes({
        forgotten: GGRpc.GET("forgotten"),
    })

/**
 * WS fixture used to verify the cross-transport infectious rule: `connectPermission`
 * is set (to `GG_NO_PERMISSIONS`, which still counts as "declared"), so strict
 * mode flips on for the entire `GGHttpServer` — any HTTP route registered on
 * the same server that omitted `permission` must fail the startup check.
 *
 * connectPermission is intentionally `GG_NO_PERMISSIONS` rather than a real
 * scope so the orphan-resolver check stays quiet — the test then isolates the
 * "WS declaration infects HTTP" path.
 */
const StartupCheckWsConnectGatedMethods = {
    clientToServer: {
        ping: {success: IsString, errors: [SERVER_ERROR]},
    },
    serverToClient: {},
}

export const StartupCheckWsConnectGatedApi = webSocketSchema("StartupCheckWsConnectGated")
    .path("ws/startup-check-connect-gated")
    .connectPermission(GG_NO_PERMISSIONS)
    .messages(StartupCheckWsConnectGatedMethods)
