import {GGHeader, GGHttp, GGHttpServer, GGRpc, httpSchema} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {GG_NO_PERMISSIONS, GGContractClass, IsEnum, IsString, SERVER_ERROR} from "@grest-ts/schema"
import {WireUserApi} from "./api/WireAuthApi"
import {WireUserService} from "./WireAuthService"

// Declares "WIRE_ADMIN" — the SAME string USER_TOKEN_WIRE already owns. Two wires owning one
// permission string is a config bug → startup must crash (Rule 6, global uniqueness).
const DUP_WIRE = new GGHeader("x-dup", {permissions: IsEnum({ADMIN: "WIRE_ADMIN"})})

const DupContract = new GGContractClass("WireDup", {
    ping: {success: IsString, errors: [SERVER_ERROR], permission: GG_NO_PERMISSIONS},
})
const DupApi = httpSchema(DupContract).pathPrefix("api/wire-dup").use(DUP_WIRE).routes({ping: GGRpc.GET("ping")})

class DupImpl {
    public ping = async (): Promise<string> => "x"
}

export class WireAuthDuplicatePermRuntime extends GGRuntime {
    public static readonly NAME = "wire-auth-dup-perm"

    protected compose(): void {
        const server = new GGHttpServer()
        new GGHttp(server)
            .http(WireUserApi, new WireUserService())
            .http(DupApi, new DupImpl())
    }
}

WireAuthDuplicatePermRuntime.cli(import.meta.url).then()
