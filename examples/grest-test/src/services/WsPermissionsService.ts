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

        // Push a server-originated message right after the connection opens.
        // The s2c gate is intentionally a no-op (no caller identity to check),
        // so unauthenticated callers should still receive this push.
        // Fire-and-forget; the await pattern is for symmetry with the contract.
        setImmediate(() => {
            void outgoing.echo("hello-from-server")
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
