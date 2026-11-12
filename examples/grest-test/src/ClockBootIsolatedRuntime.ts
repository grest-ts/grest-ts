import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {ClockBootIsolatedApi} from "./api/ClockBootApi"

const BOOT = Date.now()

export class ClockBootIsolatedRuntime extends GGRuntime {
    public static readonly NAME = "clock-boot-isolated"

    protected compose(): void {
        new GGHttp(new GGHttpServer()).http(ClockBootIsolatedApi, {boot: async () => BOOT})
    }
}

ClockBootIsolatedRuntime.cli(import.meta.url).then()
