import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {MockableApi} from "./api/MockableApi"
import {UPSTREAM_REFUSED, Upstream} from "./services/mockable/Upstream"

export class MockableRuntime extends GGRuntime {
    public static readonly NAME = "mockable"

    protected compose(): void {
        new GGHttp(new GGHttpServer()).http(MockableApi, new MockableApiImpl(new Upstream()))
    }
}

class MockableApiImpl {

    private readonly upstream: Upstream

    constructor(upstream: Upstream) {
        this.upstream = upstream
    }

    public lookup = async ({id}: {id: string}) => {
        try {
            return await this.upstream.lookup({id})
        } catch (error) {
            if (UPSTREAM_REFUSED.is(error)) return "refused:" + error.data.reason
            throw error
        }
    }

    public tagged = async (input: {id: string, tag: string}) => this.upstream.tagged(input)

    public pair = async ({id, count}: {id: string, count: number}) => this.upstream.pair(id, count)

    public named = async ({id}: {id: string}) => this.upstream.named(id)

    public field = async ({id, count}: {id: string, count: number}) => this.upstream.field(id, count)

    public refuse = async ({reason}: {reason: string}) => {
        try {
            return await this.upstream.refuse(reason)
        } catch (error) {
            if (UPSTREAM_REFUSED.is(error)) return "refused:" + error.data.reason
            throw error
        }
    }
}

MockableRuntime.cli(import.meta.url).then()
