import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {StartupCheckAllPublicApi} from "./api/StartupCheckBadApi"

class AllPublicImpl {
    public ping = async () => "ping-ok"
    public pong = async () => "pong-ok"
}

/**
 * Runtime that registers a contract whose every method is GG_NO_PERMISSIONS.
 * Strict mode is on (declarations exist) but every route satisfies coverage,
 * so the server boots cleanly.
 */
export class StartupCheckAllPublicRuntime extends GGRuntime {
    public static readonly NAME = "startup-check-all-public"

    protected compose(): void {
        const httpServer = new GGHttpServer()
        new GGHttp(httpServer).http(StartupCheckAllPublicApi, new AllPublicImpl())
    }
}

StartupCheckAllPublicRuntime.cli(import.meta.url).then()
