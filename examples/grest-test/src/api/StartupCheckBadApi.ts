import {GGRpc, httpSchema} from "@grest-ts/http"
import {
    FORBIDDEN,
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
