import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {StartupCheckBadApi} from "./api/StartupCheckBadApi"

class Impl {
    public needsScope = async () => "never reached"
}

const dummyResolver = (): ReadonlySet<string> | null => null

/**
 * Order-sensitivity check: `.http(...)` is called BEFORE `.usePermissions(...)`.
 * The http() call snapshots a resolver of `undefined`, so the schema's
 * non-public method triggers the startup check at registration even though
 * a resolver is wired later. This is the safe behavior — silent
 * under-protection would otherwise depend on builder-call order.
 */
export class StartupCheckOrderRuntime extends GGRuntime {
    public static readonly NAME = "startup-check-order"

    protected compose(): void {
        const httpServer = new GGHttpServer()
        new GGHttp(httpServer)
            .http(StartupCheckBadApi, new Impl())   // resolver not yet wired — registration must throw
            .usePermissions(dummyResolver)
    }
}

StartupCheckOrderRuntime.cli(import.meta.url).then()
