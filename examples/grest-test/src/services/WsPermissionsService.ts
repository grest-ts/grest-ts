import {WebSocketIncoming, WebSocketOutgoing} from "@grest-ts/websocket"
import {
    WsFeatureIncoming,
    WsFeatureOutgoing,
    WsPermissionsIncoming,
    WsPermissionsOutgoing,
} from "../api/WsPermissionsApi"

type Incoming = WebSocketIncoming<WsPermissionsIncoming>
type Outgoing = WebSocketOutgoing<WsPermissionsOutgoing>

export class WsPermissionsService {

    public handleConnection = (incoming: Incoming, _outgoing: Outgoing): void => {
        incoming.on({
            publicMessage: async (text) => `pub:${text}`,
            needsRead: async (text) => `read:${text}`,
            needsAllReadWrite: async (text) => `rw:${text}`,
            needsAnyReadOrAdmin: async (text) => `roa:${text}`,
        })
    }
}

type FeatureIncoming = WebSocketIncoming<WsFeatureIncoming>
type FeatureOutgoing = WebSocketOutgoing<WsFeatureOutgoing>

export class WsFeaturePermissionsService {

    public handleConnection = (incoming: FeatureIncoming, _outgoing: FeatureOutgoing): void => {
        incoming.on({
            ping: async () => "pong",
        })
    }
}
