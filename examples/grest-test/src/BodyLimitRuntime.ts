import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {BodyLimitApi} from "./api/BodyLimitApi"

class BodyLimitImpl {
    public echoDefault = async ({data}: {data: string}) => data.length
    public echoSmall = async ({data}: {data: string}) => data.length
    public echoBig = async ({data}: {data: string}) => data.length
}

export class BodyLimitRuntime extends GGRuntime {
    public static readonly NAME = "body-limit"

    protected compose(): void {
        const httpServer = new GGHttpServer()
        new GGHttp(httpServer).http(BodyLimitApi, new BodyLimitImpl())
    }
}

BodyLimitRuntime.cli(import.meta.url).then()
