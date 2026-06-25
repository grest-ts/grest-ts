import {GG_NO_PERMISSIONS, IsObject, IsString, SERVER_ERROR} from "@grest-ts/schema"
import {ChatContract, ChatSocket} from "./ChatSocket"

export const Presence = ChatContract.extend("Presence", {
    clientToServer: {
        setStatus: {input: IsObject({status: IsString}), errors: [SERVER_ERROR], permission: GG_NO_PERMISSIONS},
    },
    serverToClient: {
        presenceChanged: {input: IsObject({status: IsString})},
    },
})

export const PresenceSocket = ChatSocket.extend(Presence)
