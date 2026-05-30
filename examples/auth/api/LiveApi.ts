import {defineSocketContract, webSocketSchema} from "@grest-ts/websocket"
import {FORBIDDEN, IsNumber, IsObject, IsString, NOT_AUTHORIZED, SERVER_ERROR, GG_NO_PERMISSIONS} from "@grest-ts/schema"
import {USER_TOKEN_WIRE, UserPermission} from "./auth/UserAuth"

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

export const IsBannerPongEvent = IsObject({
    count: IsNumber.docs({title: "Total banner clicks"}),
    username: IsString.docs({title: "Username of clicker"}),
})
export type BannerPongEvent = typeof IsBannerPongEvent.infer

export const LiveApiContract = defineSocketContract("LiveApi", {
    clientToServer: {
        // Anyone authenticated can ping.
        ping: {
            permission: GG_NO_PERMISSIONS,
        },
        // Only users with CAN_SEE_RED_BANNER can send bannerPing.
        bannerPing: {
            permission: UserPermission.CAN_SEE_RED_BANNER,
            errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
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
        // Pushed to all connected clients when a banner click happens.
        bannerPong: {
            input: IsBannerPongEvent,
            permission: GG_NO_PERMISSIONS,
        },
    },
})

export const LiveApi = webSocketSchema(LiveApiContract)
    .path("ws/live")
    .use(USER_TOKEN_WIRE)
    .done()
