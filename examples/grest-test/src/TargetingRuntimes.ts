import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {GGContractClient} from "@grest-ts/schema"
import {STORE_REFUSED, TargetingGatewayApi, TargetingStoreApi, TargetingStoreContract} from "./api/TargetingApi"
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

    public refuse = async (): Promise<void> => {
        throw new STORE_REFUSED({reason: "closed"})
    }
}

/** Calls the store through discovery, so the test router picks the store instance. */
export class TargetingGatewayRuntime extends GGRuntime {
    public static readonly NAME = "targetingGateway"

    protected compose(): void {
        new GGHttp(new GGHttpServer()).http(TargetingGatewayApi, new TargetingGateway(TargetingStoreApi.createClient()))
    }
}

class TargetingGateway {

    private readonly store: GGContractClient<typeof TargetingStoreContract.methods>
    private readonly acked: string[] = []

    constructor(store: GGContractClient<typeof TargetingStoreContract.methods>) {
        this.store = store
    }

    public save = async ({text, times}: {text: string, times: number}) => {
        const by: string[] = []
        for (let i = 0; i < times; i++) {
            by.push(await this.store.save({text}).then(note => note.by, error => "failed:" + error.type))
        }
        return by
    }

    public saveAndStamp = async ({text}: {text: string}) => {
        const note = await this.store.save({text})
        return note.by + "|" + await this.store.stamp()
    }

    public stamp = async ({times}: {times: number}) => {
        const stamps: string[] = []
        for (let i = 0; i < times; i++) stamps.push(await this.store.stamp())
        return stamps
    }

    public refuse = async () => {
        try {
            await this.store.refuse()
            return "accepted"
        } catch (error) {
            if (STORE_REFUSED.is(error)) return "refused:" + error.data.reason
            throw error
        }
    }

    public ack = async ({text}: {text: string}): Promise<void> => {
        this.acked.push(text)
    }

    public acks = async () => this.acked
}

TargetingStoreRuntime.cli(import.meta.url).then()
TargetingGatewayRuntime.cli(import.meta.url).then()
