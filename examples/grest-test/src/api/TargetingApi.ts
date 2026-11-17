import {GGHttpSchema, GGRpc} from "@grest-ts/http"
import {ERROR, GGContractClass, IsArray, IsNumber, IsObject, IsString, SERVER_ERROR} from "@grest-ts/schema"

export const STORE_REFUSED = ERROR.badRequest("STORE_REFUSED", IsObject({reason: IsString}))

export const IsStoredNote = IsObject({text: IsString, by: IsString})

export const TargetingStoreContract = new GGContractClass("TargetingStoreApi", {
    save: {
        input: IsObject({text: IsString}),
        success: IsStoredNote,
        errors: [SERVER_ERROR],
    },
    stamp: {
        success: IsString,
        errors: [SERVER_ERROR],
    },
    find: {
        input: IsObject({id: IsString, tag: IsString}),
        success: IsString,
        errors: [SERVER_ERROR],
    },
    refuse: {
        errors: [STORE_REFUSED, SERVER_ERROR],
    },
})

export const TargetingStoreApi = new GGHttpSchema({
    contract: TargetingStoreContract,
    pathPrefix: "api/targeting-store",
    routes: {
        save: GGRpc.POST("save"),
        stamp: GGRpc.POST("stamp"),
        find: GGRpc.GET("find/:id"),
        refuse: GGRpc.POST("refuse"),
    },
})

export const TargetingGatewayContract = new GGContractClass("TargetingGatewayApi", {
    save: {
        input: IsObject({text: IsString, times: IsNumber}),
        success: IsArray(IsString),
        errors: [SERVER_ERROR],
    },
    saveAndStamp: {
        input: IsObject({text: IsString}),
        success: IsString,
        errors: [SERVER_ERROR],
    },
    stamp: {
        input: IsObject({times: IsNumber}),
        success: IsArray(IsString),
        errors: [SERVER_ERROR],
    },
    find: {
        input: IsObject({id: IsString, tag: IsString}),
        success: IsString,
        errors: [SERVER_ERROR],
    },
    refuse: {
        success: IsString,
        errors: [SERVER_ERROR],
    },
    ack: {
        input: IsObject({text: IsString}),
        errors: [SERVER_ERROR],
    },
    acks: {
        success: IsArray(IsString),
        errors: [SERVER_ERROR],
    },
})

export const TargetingGatewayApi = new GGHttpSchema({
    contract: TargetingGatewayContract,
    pathPrefix: "api/targeting-gateway",
    routes: {
        save: GGRpc.POST("save"),
        saveAndStamp: GGRpc.POST("save-and-stamp"),
        stamp: GGRpc.POST("stamp"),
        find: GGRpc.POST("find"),
        refuse: GGRpc.POST("refuse"),
        ack: GGRpc.POST("ack"),
        acks: GGRpc.POST("acks"),
    },
})
