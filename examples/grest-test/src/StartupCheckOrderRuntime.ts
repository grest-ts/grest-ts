import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {StartupCheckBadApi} from "./api/StartupCheckBadApi"

class Impl {
    public needsScope = async () => "never reached"
}

// QUARANTINED fixture (its test is describe.skip in permissions-startup.test.ts). The old
// `.usePermissions(...)` builder step no longer exists in the wire-based model — the non-public
// route trips the startup check via its un-created wire instead.
export class StartupCheckOrderRuntime extends GGRuntime {
    public static readonly NAME = "startup-check-order"

    protected compose(): void {
        const httpServer = new GGHttpServer()
        new GGHttp(httpServer)
            .http(StartupCheckBadApi, new Impl())
    }
}

StartupCheckOrderRuntime.cli(import.meta.url).then()
