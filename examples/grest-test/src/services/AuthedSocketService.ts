import {WebSocketIncoming, WebSocketOutgoing} from "@grest-ts/websocket"
import {AuthedSocketIncoming, AuthedSocketOutgoing, SERVER_AUTHED_USER} from "../api/AuthedSocketApi"

type Incoming = WebSocketIncoming<AuthedSocketIncoming>
type Outgoing = WebSocketOutgoing<AuthedSocketOutgoing>

export class AuthedSocketService {

    public handleConnection = (incoming: Incoming, _outgoing: Outgoing): void => {
        incoming.on({
            whoAmI: async () => {
                // Middleware set SERVER_AUTHED_USER during handshake; it inherits
                // into every per-message context via the connection context.
                return SERVER_AUTHED_USER.assert()
            },
        })
    }
}
