import {defineSocketContract, webSocketSchema} from "@grest-ts/websocket"
import {IsInt, IsObject, IsString, SERVER_ERROR} from "@grest-ts/schema"

export const IsQueryArgs = IsObject({
    room: IsString.nonEmpty,
    version: IsInt,
})
export type QueryArgs = typeof IsQueryArgs.infer

export const QuerySocketApiContract = defineSocketContract("QuerySocketApi", {
    clientToServer: {
        echoRoom: {
            success: IsString,
            errors: [SERVER_ERROR],
        },
    },
    serverToClient: {},
})

/**
 * Demonstrates `queryOnConnect(validator)` — both sides validate query params.
 * Bad query on the client throws before opening the socket; bad query that
 * somehow reaches the server causes a close with code 4000.
 */
export const QuerySocketApi = webSocketSchema(QuerySocketApiContract)
    .path("ws/query-test")
    .queryOnConnect<QueryArgs>(IsQueryArgs)
    .done()
