import {GG_NO_PERMISSIONS, IsObject, IsString, SERVER_ERROR} from "@grest-ts/schema"
import {ChatContract, ChatSocket} from "./ChatSocket"

export const Messaging = ChatContract.extend("Messaging", {
    clientToServer: {
        send: {input: IsObject({text: IsString}), success: IsObject({echoed: IsString}), errors: [SERVER_ERROR], permission: GG_NO_PERMISSIONS},
    },
    serverToClient: {
        message: {input: IsObject({text: IsString})},
    },
})

export const MessagingSocket = ChatSocket.extend(Messaging)
