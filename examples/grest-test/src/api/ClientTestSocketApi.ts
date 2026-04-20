import {defineSocketContract, webSocketSchema} from "@grest-ts/websocket"
import {
    GGContractClient,
    GGContractImplementation,
    IsBoolean,
    IsNumber,
    IsObject,
    IsString,
    SERVER_ERROR
} from "@grest-ts/schema"

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

export const ClientTestSocketApiContract = defineSocketContract("ClientTestSocketApi", {
    clientToServer: {
        // Req/res: client → server, waits for typed response
        echo: {
            input: IsEchoRequest,
            success: IsEchoResponse,
            errors: [SERVER_ERROR],
        },
        // Fire-and-forget: client → server, no response expected
        setCounter: {
            input: IsCounterValue,
        },
        // Req/res with no input: read server state
        getCounter: {
            success: IsCounterValue,
            errors: [SERVER_ERROR],
        },
        // Req/res where the server uses the connection to ask the client back,
        // then returns what the client answered — exercises server-initiated RPC.
        askMeAQuestion: {
            input: IsQuestion,
            success: IsBoolean,
            errors: [SERVER_ERROR],
        },
    },
    serverToClient: {
        // Fire-and-forget: server push
        counterChanged: {
            input: IsCounterValue,
        },
        // Req/res: server → client, waits for client's typed response
        needsConfirmation: {
            input: IsQuestion,
            success: IsBoolean,
            errors: [SERVER_ERROR],
        },
    },
})

export const ClientTestSocketApi = webSocketSchema(ClientTestSocketApiContract)
    .path("ws/client-test")
    .done()

export type ClientTestSocketIncoming = GGContractImplementation<typeof ClientTestSocketApiContract.methods["clientToServer"]>
export type ClientTestSocketOutgoing = GGContractClient<typeof ClientTestSocketApiContract.methods["serverToClient"]>
