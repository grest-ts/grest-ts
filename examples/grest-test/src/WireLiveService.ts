import {WireLiveApi} from "./api/WireAuthApi"
import {USER_DATA} from "./WireAuthService"

export class WireLiveService {
    // USER_DATA was minted by USER_TOKEN_WIRE's process() at handshake and persists on the
    // connection context — per-message handlers read the durable principal, never the token.
    public handleConnection = (incoming: typeof WireLiveApi.clientToServer, _outgoing: typeof WireLiveApi.serverToClient): void => {
        incoming.on({
            whoami: async () => USER_DATA.get()!.username,
            adminPing: async () => "admin-pong",
        })
    }
}
