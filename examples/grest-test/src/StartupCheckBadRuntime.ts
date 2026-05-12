import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {StartupCheckBadApi} from "./api/StartupCheckBadApi"

class BadImpl {
    public needsScope = async () => "should never get here"
}

/**
 * Intentionally misconfigured: registers a contract with a non-public method
 * via GGHttp.http(...) without .usePermissions(...). The startup check
 * must abort compose with an actionable error.
 */
export class StartupCheckBadRuntime extends GGRuntime {
    public static readonly NAME = "startup-check-bad"

    protected compose(): void {
        const httpServer = new GGHttpServer()
        // Missing .usePermissions(...) by design — this is what we're testing.
        new GGHttp(httpServer).http(StartupCheckBadApi, new BadImpl())
    }
}

StartupCheckBadRuntime.cli(import.meta.url).then()
