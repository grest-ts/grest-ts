import {GGRuntime} from "@grest-ts/runtime"
import {GGConnectionSettingsKey, GGHttp, GGHttpSchema, GGHttpServer, GGRpc} from "@grest-ts/http"
import {GGContext} from "@grest-ts/context"
import {GGContractClass, GG_NO_PERMISSIONS, IsObject, IsString, SERVER_ERROR} from "@grest-ts/schema"

export const PIN_CONN = new GGConnectionSettingsKey("spikePinConn")

export const SpikeTargetApi = new GGHttpSchema({
    contract: new GGContractClass("SpikeTargetApi", {
        ping: {input: IsObject({msg: IsString}), success: IsObject({pong: IsString}), errors: [SERVER_ERROR], permission: GG_NO_PERMISSIONS},
    }),
    pathPrefix: "api/spike-target",
    use: [PIN_CONN],
    routes: {ping: GGRpc.POST("ping")},
})

export const SpikeCallerApi = new GGHttpSchema({
    contract: new GGContractClass("SpikeCallerApi", {
        trigger: {input: IsObject({msg: IsString}), success: IsObject({pong: IsString}), errors: [SERVER_ERROR], permission: GG_NO_PERMISSIONS},
    }),
    pathPrefix: "api/spike-caller",
    routes: {trigger: GGRpc.POST("trigger")},
})

export class SpikePinnedRuntime extends GGRuntime {
    public static readonly NAME = "spike-pinned"

    protected compose(): void {
        const target = SpikeTargetApi.createClient({url: "", timeout: 2000})
        new GGHttp(new GGHttpServer()).http(SpikeCallerApi, {
            trigger: async ({msg}) => new GGContext("pinned").run(async () => {
                PIN_CONN.set({host: "127.0.0.1", port: 1, tlsPin: {fingerprint256: "a".repeat(64)}})
                return await target.ping({msg})
            }),
        })
    }
}

SpikePinnedRuntime.cli(import.meta.url).then();
