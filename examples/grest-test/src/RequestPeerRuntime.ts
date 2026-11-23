import {GG_HTTP_REQUEST, GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {GGContextKey} from "@grest-ts/context"
import {IsBoolean} from "@grest-ts/schema"
import {GG_TRACE} from "@grest-ts/trace"
import {RequestPeerApi} from "./api/RequestPeerApi"

export const RAW_ROUTE_PATH = "/raw/who-am-i"
const RAW_MARK = new GGContextKey<boolean>("raw-route-mark", IsBoolean)

export class RequestPeerRuntime extends GGRuntime {
    public static readonly NAME = "request-peer"

    protected compose(): void {
        const httpServer = new GGHttpServer()
        new GGHttp(httpServer).http(RequestPeerApi, new RequestPeerApiImpl())
        httpServer.registerRoute("GET", RAW_ROUTE_PATH, async (_req, res) => {
            const request = GG_HTTP_REQUEST.get()
            const seen = {userAgent: request?.userAgent, pathTemplate: request?.pathTemplate, traceId: GG_TRACE.get()?.traceId, marked: RAW_MARK.has()}
            RAW_MARK.set(true)
            res.writeHead(200, {"content-type": "application/json"})
            res.end(JSON.stringify(seen))
        })
        httpServer.announce(RAW_ROUTE_PATH, "RequestPeer")
    }
}

class RequestPeerApiImpl {
    public whoAmI = async () => {
        const {peerAddress, userAgent, forwardedFor} = GG_HTTP_REQUEST.get()!
        return {peerAddress, userAgent, forwardedFor}
    }
}

RequestPeerRuntime.cli(import.meta.url).then()
