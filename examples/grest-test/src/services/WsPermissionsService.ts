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

    public handleConnection = (incoming: Incoming, outgoing: Outgoing): void => {
        incoming.on({
            publicMessage: async (text) => `pub:${text}`,
            needsRead: async (text) => `read:${text}`,
            needsAllReadWrite: async (text) => `rw:${text}`,
            needsAnyReadOrAdmin: async (text) => `roa:${text}`,
        })

        // Push a server-originated message shortly after connection.
        // setImmediate would race the client's setup callback (where the s2c
        // handler is registered), so the push must wait until the client has
        // had a chance to subscribe — 50ms is comfortably longer than any
        // setup work the client does after the handshake.
        setTimeout(() => {
            void outgoing.echo("hello-from-server")
        }, 50)
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
