import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {ClockLateApi} from "./api/ClockApi"
import {ClockApiImpl} from "./services/ClockApiImpl"

// Own file: startIsolated runs the runtime whose cli() the module calls, so it must be the only one.
export class ClockLateIsolatedRuntime extends GGRuntime {
    public static readonly NAME = "clock-late-isolated"

    protected compose(): void {
        new GGHttp(new GGHttpServer()).http(ClockLateApi, new ClockApiImpl())
    }
}

ClockLateIsolatedRuntime.cli(import.meta.url).then()
