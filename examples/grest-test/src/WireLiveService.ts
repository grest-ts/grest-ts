import {WebSocketIncoming, WebSocketOutgoing} from "@grest-ts/websocket"
import {WireLiveIncoming, WireLiveOutgoing} from "./api/WireAuthApi"
import {USER_DATA} from "./WireAuthService"

type Incoming = WebSocketIncoming<WireLiveIncoming>
type Outgoing = WebSocketOutgoing<WireLiveOutgoing>

export class WireLiveService {
    // USER_DATA was minted by USER_TOKEN_WIRE's process() at handshake and persists on the
    // connection context — per-message handlers read the durable principal, never the token.
    public handleConnection = (incoming: Incoming, _outgoing: Outgoing): void => {
        incoming.on({
            whoami: async () => USER_DATA.get()!.username,
            adminPing: async () => "admin-pong",
        })
    }
}
