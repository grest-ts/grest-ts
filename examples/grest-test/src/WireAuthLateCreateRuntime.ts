import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {WireUserApi} from "./api/WireAuthApi"
import {USER_TOKEN_WIRE_HANDLER, WireUserService} from "./WireAuthService"

/** Registers the schema first and creates its wire handler afterwards — legal any time before start. */
export class WireAuthLateCreateRuntime extends GGRuntime {
    public static readonly NAME = "wire-auth-late-create"

    protected compose(): void {
        const userService = new WireUserService()
        new GGHttp(new GGHttpServer()).http(WireUserApi, userService)
        USER_TOKEN_WIRE_HANDLER.create(userService)
    }
}

WireAuthLateCreateRuntime.cli(import.meta.url).then()
