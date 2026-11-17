import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {ClockIsolatedApi} from "./api/ClockApi"
import {ClockApiImpl} from "./services/ClockApiImpl"

// Own file: startIsolated runs the runtime whose cli() the module calls, so it must be the only one.
export class ClockIsolatedRuntime extends GGRuntime {
    public static readonly NAME = "clock-isolated"

    protected compose(): void {
        new GGHttp(new GGHttpServer()).http(ClockIsolatedApi, new ClockApiImpl())
    }
}

ClockIsolatedRuntime.cli(import.meta.url).then()
