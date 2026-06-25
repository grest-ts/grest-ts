import {GGWebSocketSchema} from "@grest-ts/websocket"
import {GGDuplexContract, IsNumber, IsObject, IsString, SERVER_ERROR, GG_NO_PERMISSIONS} from "@grest-ts/schema"

export const IsQueryArgs = IsObject({
    room: IsString.nonEmpty,
    version: IsNumber,
})
export type QueryArgs = typeof IsQueryArgs.infer

/**
 * Demonstrates `connect.input` — both sides validate query params. Bad query on the
 * client throws before opening the socket; bad query that somehow reaches the server
 * causes a close with code 4000.
 */
export const QuerySocketApiContract = new GGDuplexContract("QuerySocketApi", {
    connect: {
        input: IsQueryArgs,
        errors: [SERVER_ERROR],
    },
    clientToServer: {
        echoRoom: {
            success: IsString,
            errors: [SERVER_ERROR],
            permission: GG_NO_PERMISSIONS
        },
    },
    serverToClient: {},
})

export const QuerySocketApi = new GGWebSocketSchema({
    contract: QuerySocketApiContract,
    path: "ws/query-test",
})
