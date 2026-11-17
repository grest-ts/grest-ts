import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {ClockInlineApi, ClockLateApi, ClockWorkerApi} from "./api/ClockApi"
import {ClockApiImpl} from "./services/ClockApiImpl"

export class ClockInlineRuntime extends GGRuntime {
    public static readonly NAME = "clock-inline"

    protected compose(): void {
        new GGHttp(new GGHttpServer()).http(ClockInlineApi, new ClockApiImpl())
    }
}

export class ClockWorkerRuntime extends GGRuntime {
    public static readonly NAME = "clock-worker"

    protected compose(): void {
        new GGHttp(new GGHttpServer()).http(ClockWorkerApi, new ClockApiImpl())
    }
}

export class ClockLateRuntime extends GGRuntime {
    public static readonly NAME = "clock-late"

    protected compose(): void {
        new GGHttp(new GGHttpServer()).http(ClockLateApi, new ClockApiImpl())
    }
}

ClockInlineRuntime.cli(import.meta.url).then()
ClockWorkerRuntime.cli(import.meta.url).then()
ClockLateRuntime.cli(import.meta.url).then()
