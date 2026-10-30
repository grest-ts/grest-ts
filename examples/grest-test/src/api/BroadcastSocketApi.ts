import {GGWebSocketSchema} from "@grest-ts/websocket"
import {GGDuplexContract, GG_NO_PERMISSIONS, IsArray, IsBoolean, IsNumber, IsObject} from "@grest-ts/schema"

export const BroadcastSocketApiContract = new GGDuplexContract("BroadcastSocketApi", {
    connect: {},
    clientToServer: {
        requestSnapshot: {
            input: IsObject({delayMs: IsNumber.orUndefined, fail: IsBoolean.orUndefined}),
            permission: GG_NO_PERMISSIONS,
        },
        publish: {
            input: IsObject({value: IsNumber}),
            permission: GG_NO_PERMISSIONS,
        },
    },
    serverToClient: {
        onSnapshot: {
            input: IsObject({values: IsArray(IsNumber)}),
            permission: GG_NO_PERMISSIONS,
        },
        onValue: {
            input: IsObject({value: IsNumber}),
            permission: GG_NO_PERMISSIONS,
        },
    },
})

export const BroadcastSocketApi = new GGWebSocketSchema({
    contract: BroadcastSocketApiContract,
    path: "ws/broadcast-test",
})
