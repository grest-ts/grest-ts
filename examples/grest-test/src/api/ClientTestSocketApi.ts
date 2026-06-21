import {webSocketSchema} from "@grest-ts/websocket"
import {
    GGContractClient,
    GGContractImplementation,
    IsBoolean,
    IsNumber,
    IsObject,
    IsString,
    SERVER_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema"

// ---------------------------------------------------------
// Schemas
// ---------------------------------------------------------

export const IsEchoRequest = IsObject({
    message: IsString,
})
export type EchoRequest = typeof IsEchoRequest.infer

export const IsEchoResponse = IsObject({
    message: IsString,
    echoedBy: IsString,
})
export type EchoResponse = typeof IsEchoResponse.infer

export const IsCounterValue = IsObject({
    value: IsNumber,
})
export type CounterValue = typeof IsCounterValue.infer

export const IsQuestion = IsObject({
    prompt: IsString,
})
export type Question = typeof IsQuestion.infer

// ---------------------------------------------------------
// Contract — demonstrates all four websocket messaging modes
// ---------------------------------------------------------

const ClientTestSocketApiMethods = {
    clientToServer: {
        // Req/res: client → server, waits for typed response
        echo: {
            input: IsEchoRequest,
            success: IsEchoResponse,
            errors: [SERVER_ERROR],
            permission: GG_NO_PERMISSIONS
        },
        // Fire-and-forget: client → server, no response expected
        setCounter: {
            input: IsCounterValue,
            permission: GG_NO_PERMISSIONS
        },
        // Req/res with no input: read server state
        getCounter: {
            success: IsCounterValue,
            errors: [SERVER_ERROR],
            permission: GG_NO_PERMISSIONS
        },
        // Req/res where the server uses the connection to ask the client back,
        // then returns what the client answered — exercises server-initiated RPC.
        askMeAQuestion: {
            input: IsQuestion,
            success: IsBoolean,
            errors: [SERVER_ERROR],
            permission: GG_NO_PERMISSIONS
        },
    },
    serverToClient: {
        // Fire-and-forget: server push
        counterChanged: {
            input: IsCounterValue,
            permission: GG_NO_PERMISSIONS
        },
        // Req/res: server → client, waits for client's typed response
        needsConfirmation: {
            input: IsQuestion,
            success: IsBoolean,
            errors: [SERVER_ERROR],
            permission: GG_NO_PERMISSIONS
        },
    },
}

export const ClientTestSocketApi = webSocketSchema("ClientTestSocketApi")
    .path("ws/client-test")
    .messages(ClientTestSocketApiMethods)

export type ClientTestSocketIncoming = GGContractImplementation<typeof ClientTestSocketApiMethods["clientToServer"]>
export type ClientTestSocketOutgoing = GGContractClient<typeof ClientTestSocketApiMethods["serverToClient"]>
