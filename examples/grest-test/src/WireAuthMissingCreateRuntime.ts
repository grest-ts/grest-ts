import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {WireUserApi} from "./api/WireAuthApi"
import {WireUserService} from "./WireAuthService"

/**
 * Intentionally misconfigured: .use()s USER_TOKEN_WIRE but never calls .create() to implement
 * it on this runtime. The startup check must refuse to start.
 */
export class WireAuthMissingCreateRuntime extends GGRuntime {
    public static readonly NAME = "wire-auth-missing-create"

    protected compose(): void {
        const server = new GGHttpServer()
        new GGHttp(server).http(WireUserApi, new WireUserService())
    }
}

WireAuthMissingCreateRuntime.cli(import.meta.url).then()
