import {defineSocketContract, webSocketSchema} from "@grest-ts/websocket"
import {IsNumber, IsObject, IsString, SERVER_ERROR, GG_NO_PERMISSIONS} from "@grest-ts/schema"
import {GG_USER_AUTH_TOKEN} from "./auth/UserAuth"

export const IsLivePongEvent = IsObject({
    username: IsString,
    timestamp: IsNumber.docs({title: "Server timestamp ms since epoch"}),
})
export type LivePongEvent = typeof IsLivePongEvent.infer

export const IsProfileUpdatedEvent = IsObject({
    username: IsString,
    email: IsString,
})
export type ProfileUpdatedEvent = typeof IsProfileUpdatedEvent.infer

export const LiveApiContract = defineSocketContract("LiveApi", {
    clientToServer: {
        ping: {
            permission: GG_NO_PERMISSIONS,
        },
    },
    serverToClient: {
        pong: {
            input: IsLivePongEvent,
            permission: GG_NO_PERMISSIONS,
        },
        profileUpdated: {
            input: IsProfileUpdatedEvent,
            errors: [SERVER_ERROR],
            permission: GG_NO_PERMISSIONS,
        },
    },
})

export const LiveApi = webSocketSchema(LiveApiContract)
    .path("ws/live")
    .use(GG_USER_AUTH_TOKEN)
    .done()
