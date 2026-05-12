import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {StartupCheckWsConnectGatedApi, StartupCheckZeroConfigApi} from "./api/StartupCheckBadApi"

class ZeroConfigImpl {
    public hello = async () => "hello"
    public world = async () => "world"
}

/**
 * Mixed HTTP + WS on the same GGHttpServer. The WS schema declares
 * `connectPermission` (`GG_NO_PERMISSIONS` — explicit-public still counts as
 * a declaration), flipping the server into strict mode. The HTTP API
 * registered on the same server omits `permission`, so the start must fail
 * naming the HTTP routes.
 */
export class StartupCheckWsTriggersHttpRuntime extends GGRuntime {
    public static readonly NAME = "startup-check-ws-triggers-http"

    protected compose(): void {
        const httpServer = new GGHttpServer()
        new GGHttp(httpServer).http(StartupCheckZeroConfigApi, new ZeroConfigImpl())
        StartupCheckWsConnectGatedApi.register(() => {}, {http: httpServer})
    }
}

StartupCheckWsTriggersHttpRuntime.cli(import.meta.url).then()
