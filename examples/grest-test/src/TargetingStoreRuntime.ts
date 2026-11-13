import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {STORE_REFUSED, TargetingStoreApi} from "./api/TargetingApi"
import {StoreClock} from "./services/targeting/StoreClock"

export class TargetingStoreRuntime extends GGRuntime {
    public static readonly NAME = "targetingStore"

    protected compose(): void {
        new GGHttp(new GGHttpServer()).http(TargetingStoreApi, new TargetingStore(new StoreClock()))
    }
}

class TargetingStore {

    private readonly clock: StoreClock

    constructor(clock: StoreClock) {
        this.clock = clock
    }

    public save = async ({text}: {text: string}) => ({text, by: "real"})

    public stamp = async () => this.clock.stamp()

    public find = async ({id, tag}: {id: string, tag: string}) => `${id}:${tag}`

    public refuse = async (): Promise<void> => {
        throw new STORE_REFUSED({reason: "closed"})
    }
}

TargetingStoreRuntime.cli(import.meta.url).then()
