import {GGRpc, httpSchema} from "@grest-ts/http"
import {
    FORBIDDEN,
    GG_NO_PERMISSIONS,
    GGContractClass,
    IsString,
    NOT_AUTHORIZED,
    SERVER_ERROR,
} from "@grest-ts/schema"

/**
 * Fixture used only by the negative startup-check test. The contract has a
 * non-public method, so wiring it via GGHttp without .usePermissions(...) must
 * throw at registration time.
 */
export const StartupCheckBadContract = new GGContractClass("StartupCheckBad", {
    needsScope: {
        success: IsString,
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
        permission: "startup:check",
    },
})

export const StartupCheckBadApi = httpSchema(StartupCheckBadContract)
    .pathPrefix("api/startup-check-bad")
    .routes({
        needsScope: GGRpc.GET("read"),
    })

/**
 * Fixture for the positive startup-check test: every method is GG_NO_PERMISSIONS.
 * Wiring via GGHttp without .usePermissions(...) must NOT throw — public-only
 * services are legitimate and start silently.
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
