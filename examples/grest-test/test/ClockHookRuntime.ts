import {GGHttp, GGHttpSchema, GGHttpServer, GGRpc} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {GGContractClass, IsArray, IsNumber, SERVER_ERROR} from "@grest-ts/schema"
import {GGTestClock} from "@grest-ts/testkit"

const offsets: number[] = []
GGTestClock.onChange(state => { offsets.push(state.offsetMs) })

export const ClockHookApi = new GGHttpSchema({
    contract: new GGContractClass("ClockHook", {
        offsets: {
            success: IsArray(IsNumber),
            errors: [SERVER_ERROR],
        },
    }),
    pathPrefix: "api/clock-hook",
    routes: {
        offsets: GGRpc.GET("offsets"),
    },
})

export class ClockHookRuntime extends GGRuntime {
    public static readonly NAME: string = "clock-hook"

    protected compose(): void {
        new GGHttp(new GGHttpServer()).http(ClockHookApi, {offsets: async () => offsets})
    }
}

ClockHookRuntime.cli(import.meta.url).then()

// `offsets` is module state, so a runtime counting its boot hooks needs a worker no earlier ClockHookRuntime ran in.
export class ClockHookLateRuntime extends ClockHookRuntime {
    public static readonly NAME = "clock-hook-late"
}
