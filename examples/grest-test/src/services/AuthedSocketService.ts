import {AuthedSocketApi, SERVER_AUTHED_USER} from "../api/AuthedSocketApi"

export class AuthedSocketService {

    public handleConnection = (incoming: typeof AuthedSocketApi.clientToServer, _outgoing: typeof AuthedSocketApi.serverToClient): void => {
        incoming.on({
            whoAmI: async () => {
                // Middleware set SERVER_AUTHED_USER during handshake; it inherits
                // into every per-message context via the connection context.
                return SERVER_AUTHED_USER.assert()
            },
        })
    }
}
