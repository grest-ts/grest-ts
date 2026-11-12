import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {ClockBootWorkerApi} from "./api/ClockBootApi"

const BOOT = Date.now()

export class ClockBootRuntime extends GGRuntime {
    public static readonly NAME = "clock-boot"

    protected compose(): void {
        new GGHttp(new GGHttpServer()).http(ClockBootWorkerApi, {boot: async () => BOOT})
    }
}

ClockBootRuntime.cli(import.meta.url).then()
