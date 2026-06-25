import {PresenceSocket} from "../api/ChatPresenceApi"

export class ChatPresenceService {

    public handle = (
        incoming: typeof PresenceSocket.clientToServer,
        outgoing: typeof PresenceSocket.serverToClient
    ): void => {
        incoming.on({
            setStatus: async ({status}) => {
                outgoing.presenceChanged({status})
            },
        })
    }
}
