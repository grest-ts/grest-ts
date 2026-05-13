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
 * Mirror of StartupCheckInfectiousRuntime, but with registration order
 * reversed: undeclared first, declared second. The infectious rule must be
 * order-independent — strict mode is per-server and decided at start, not
 * at registration time.
 */
export class StartupCheckInfectiousReverseRuntime extends GGRuntime {
    public static readonly NAME = "startup-check-infectious-reverse"

    protected compose(): void {
        const httpServer = new GGHttpServer()
        new GGHttp(httpServer)
            .http(StartupCheckUndeclaredApi, new UndeclaredImpl())
            .http(StartupCheckDeclaredApi, new DeclaredImpl())
    }
}

StartupCheckInfectiousReverseRuntime.cli(import.meta.url).then()
