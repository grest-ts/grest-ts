import {GGRpc, GGHttpSchema} from "@grest-ts/http"
import {GGContractClass, IsObject, IsString, SERVER_ERROR} from "@grest-ts/schema"

// Fixture for GG_HTTP_REQUEST's connection facts: the handler echoes what it sees.
export const RequestPeerContract = new GGContractClass("RequestPeer", {
    whoAmI: {
        success: IsObject({peerAddress: IsString.orUndefined, userAgent: IsString.orUndefined, forwardedFor: IsString.orUndefined}),
        errors: [SERVER_ERROR],
    },
})

export const RequestPeerApi = new GGHttpSchema({
    contract: RequestPeerContract,
    pathPrefix: "api/request-peer",
    routes: {
        whoAmI: GGRpc.GET("who-am-i"),
    },
})
