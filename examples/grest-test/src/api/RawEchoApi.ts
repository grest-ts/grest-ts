import {GGRawWebSocketSchema} from "@grest-ts/websocket"
import {GGRawSocketContract, IsObject, IsString, NOT_AUTHORIZED, SERVER_ERROR} from "@grest-ts/schema"
import {AuthedSocketMiddleware} from "./AuthedSocketApi"

/**
 * Raw byte-stream socket guarded by the SAME bearer-token middleware as the typed
 * AuthedSocketApi — proving a raw socket rides the exact same handshake auth as a
 * schema socket. After auth, the server owns the wire and echoes bytes.
 */
export const RawEchoApiContract = new GGRawSocketContract("RawEchoApi", {
    connect: {
        input: IsObject({room: IsString}),
        errors: [NOT_AUTHORIZED, SERVER_ERROR],
    },
})

export const RawEchoApi = new GGRawWebSocketSchema({
    contract: RawEchoApiContract,
    path: "ws/raw-echo",
    use: [AuthedSocketMiddleware],
})
