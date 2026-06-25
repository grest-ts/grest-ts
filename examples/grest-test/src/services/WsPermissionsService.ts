import {WsFeaturePermissionsApi, WsPermissionsApi} from "../api/WsPermissionsApi"

export class WsPermissionsService {

    public handleConnection = (incoming: typeof WsPermissionsApi.clientToServer, outgoing: typeof WsPermissionsApi.serverToClient): void => {
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

export class WsFeaturePermissionsService {

    public handleConnection = (incoming: typeof WsFeaturePermissionsApi.clientToServer, _outgoing: typeof WsFeaturePermissionsApi.serverToClient): void => {
        incoming.on({
            ping: async () => "pong",
        })
    }
}
