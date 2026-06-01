import {WebSocketIncoming, WebSocketOutgoing} from "@grest-ts/websocket"
import {WsCookieIncoming, WsCookieOutgoing, WS_SESSION_VALUE} from "../api/WsCookieApi"

type Incoming = WebSocketIncoming<WsCookieIncoming>
type Outgoing = WebSocketOutgoing<WsCookieOutgoing>

export class WsCookieService {

    public handleConnection = (incoming: Incoming, _outgoing: Outgoing): void => {
        incoming.on({
            whoami: async () => WS_SESSION_VALUE.get(),
            adminOnly: async () => "admin-ok",
        })
    }
}
