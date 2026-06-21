import {webSocketSchema} from "@grest-ts/websocket"
import {IsObject, IsString} from "@grest-ts/schema"
import {AuthedSocketMiddleware} from "./AuthedSocketApi"

/**
 * Raw byte-stream socket guarded by the SAME bearer-token middleware as the typed
 * AuthedSocketApi — proving a raw socket rides the exact same handshake auth as a
 * schema socket. After auth, the server owns the wire and echoes bytes.
 */
export const RawEchoApi = webSocketSchema("RawEchoApi").path("ws/raw-echo").use(AuthedSocketMiddleware).queryOnConnect(IsObject({room: IsString})).bytes()
