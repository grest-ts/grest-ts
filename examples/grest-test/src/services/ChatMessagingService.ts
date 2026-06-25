import {MessagingSocket} from "../api/ChatMessagingApi"

export class ChatMessagingService {

    public handle = (
        incoming: typeof MessagingSocket.clientToServer,
        outgoing: typeof MessagingSocket.serverToClient
    ): void => {
        incoming.on({
            send: async ({text}) => {
                outgoing.message({text: `echo:${text}`})
                return {echoed: text}
            },
        })
    }
}
