import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {StartupCheckDeclaredApi, StartupCheckUndeclaredApi} from "./api/StartupCheckBadApi"

class DeclaredImpl {
    public publicOne = async () => "ok"
}
class UndeclaredImpl {
    public forgotten = async () => "ok"
}

/**
 * Two contracts on one server: one declares permissions (even just
 * GG_NO_PERMISSIONS counts), one doesn't. The first triggers strict mode and
 * the second's `forgotten` method must fail the start with a clear message.
 */
export class StartupCheckInfectiousRuntime extends GGRuntime {
    public static readonly NAME = "startup-check-infectious"

    protected compose(): void {
        const httpServer = new GGHttpServer()
        new GGHttp(httpServer)
            .http(StartupCheckDeclaredApi, new DeclaredImpl())
            .http(StartupCheckUndeclaredApi, new UndeclaredImpl())
    }
}

StartupCheckInfectiousRuntime.cli(import.meta.url).then()
