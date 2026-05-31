import {GGHttp, GGHttpServer, GGRpc, httpSchema} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {FORBIDDEN, GGContractClass, IsString, NOT_AUTHORIZED, SERVER_ERROR} from "@grest-ts/schema"
import {OrgWirePermission, USER_TOKEN_WIRE, WireOrgScopedApi} from "./api/WireAuthApi"
import {WireOrgService} from "./WireAuthService"

// Requires ORG_MEMBER (owned by ORG_TOKEN_WIRE) but only .use()s the user wire. ORG_TOKEN_WIRE is
// indexed via WireOrgScopedApi, so the gate could never satisfy this method → startup must crash.
const BadContract = new GGContractClass("WireBadOwning", {
    needsOrg: {
        success: IsString,
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
        permission: OrgWirePermission.ORG_MEMBER,
    },
})
const BadApi = httpSchema(BadContract).pathPrefix("api/wire-bad").use(USER_TOKEN_WIRE).routes({needsOrg: GGRpc.GET("x")})

class BadImpl {
    public needsOrg = async (): Promise<string> => "x"
}

export class WireAuthBadOwningRuntime extends GGRuntime {
    public static readonly NAME = "wire-auth-bad-owning"

    protected compose(): void {
        const server = new GGHttpServer()
        new GGHttp(server)
            .http(WireOrgScopedApi, new WireOrgService())
            .http(BadApi, new BadImpl())
    }
}

WireAuthBadOwningRuntime.cli(import.meta.url).then()
