import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {StartupCheckZeroConfigApi} from "./api/StartupCheckBadApi"

class ZeroConfigImpl {
    public hello = async () => "hello"
    public world = async () => "world"
}

/**
 * Zero permission wiring at all: no contract method sets `permission`. Strict
 * mode is never triggered, so this boots cleanly — the validation cost for the
 * no-auth case is zero.
 */
export class StartupCheckZeroConfigRuntime extends GGRuntime {
    public static readonly NAME = "startup-check-zero-config"

    protected compose(): void {
        const httpServer = new GGHttpServer()
        new GGHttp(httpServer).http(StartupCheckZeroConfigApi, new ZeroConfigImpl())
    }
}

StartupCheckZeroConfigRuntime.cli(import.meta.url).then()
