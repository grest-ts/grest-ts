import {GG_HTTP_REQUEST, GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {RequestPeerApi} from "./api/RequestPeerApi"

export class RequestPeerRuntime extends GGRuntime {
    public static readonly NAME = "request-peer"

    protected compose(): void {
        const httpServer = new GGHttpServer()
        new GGHttp(httpServer).http(RequestPeerApi, new RequestPeerApiImpl())
    }
}

class RequestPeerApiImpl {
    public whoAmI = async () => {
        const {peerAddress, userAgent, forwardedFor} = GG_HTTP_REQUEST.get()!
        return {peerAddress, userAgent, forwardedFor}
    }
}

RequestPeerRuntime.cli(import.meta.url).then()
