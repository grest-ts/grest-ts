import {WebSocketIncoming, WebSocketOutgoing} from "@grest-ts/websocket"
import {SESSION_VALUE} from "../api/CookieTestApi"
import {WsCookieIncoming, WsCookieOutgoing} from "../api/WsCookieApi"

type Incoming = WebSocketIncoming<WsCookieIncoming>
type Outgoing = WebSocketOutgoing<WsCookieOutgoing>

export class WsCookieService {

    public handleConnection = (incoming: Incoming, _outgoing: Outgoing): void => {
        incoming.on({
            whoami: async () => SESSION_VALUE.get(),
            adminOnly: async () => "admin-ok",
        })
    }
}
