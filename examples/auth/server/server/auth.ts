import {GGRuntime} from "@grest-ts/runtime"
import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {AuthPublicApi} from "../../api/AuthPublicApi"
import {UserApi} from "../../api/UserApi"
import {LiveApi} from "../../api/LiveApi"
import {UserContextMiddleware} from "./UserContext"
import {UserService} from "./services/UserService"
import {LiveService} from "./services/LiveService"

export class AppRuntime extends GGRuntime {
    public static readonly NAME = "auth"

    protected compose(): void {
        const server = new GGHttpServer()
        const userService = new UserService()
        const liveService = new LiveService(userService)
        const userContextMiddleware = new UserContextMiddleware(userService)

        // Public routes — no auth required
        new GGHttp(server)
            .http(AuthPublicApi, userService)

        // Protected routes — token + user context required
        new GGHttp(server)
            .use(userContextMiddleware)
            .http(UserApi, userService)

        // WebSocket — attaches to the same server, requires auth token via handshake
        LiveApi.register(liveService.handleConnection, {
            middlewares: [userContextMiddleware],
        })
    }
}

AppRuntime.cli(import.meta.url).then()
