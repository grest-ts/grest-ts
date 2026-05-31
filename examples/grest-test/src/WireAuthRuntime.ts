import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {WirePublicApi, WireUserApi} from "./api/WireAuthApi"
import {USER_TOKEN_WIRE_HANDLER, WirePublicService, WireUserService} from "./WireAuthService"

export class WireAuthRuntime extends GGRuntime {
    public static readonly NAME = "wire-auth"

    protected compose(): void {
        const server = new GGHttpServer()
        const userService = new WireUserService()

        // Bind the wire's deps into THIS runtime's scope. No usePermissions / no resolver list —
        // the schema carries the wire, the gate reads its permissions().
        USER_TOKEN_WIRE_HANDLER.create(userService)

        new GGHttp(server)
            .http(WireUserApi, userService)
            .http(WirePublicApi, new WirePublicService())
    }
}

WireAuthRuntime.cli(import.meta.url).then()
