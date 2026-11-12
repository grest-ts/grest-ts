import {GGRpc, GGHttpSchema} from "@grest-ts/http"
import {GGContractClass, IsNumber, IsObject, IsString, SERVER_ERROR} from "@grest-ts/schema"

export const MockableContract = new GGContractClass("MockableApi", {
    lookup: {
        input: IsObject({id: IsString}),
        success: IsString,
        errors: [SERVER_ERROR],
    },
    tagged: {
        input: IsObject({id: IsString, tag: IsString}),
        success: IsString,
        errors: [SERVER_ERROR],
    },
    pair: {
        input: IsObject({id: IsString, count: IsNumber}),
        success: IsString,
        errors: [SERVER_ERROR],
    },
    named: {
        input: IsObject({id: IsString}),
        success: IsString,
        errors: [SERVER_ERROR],
    },
})

export const MockableApi = new GGHttpSchema({
    contract: MockableContract,
    pathPrefix: "api/mockable",
    routes: {
        lookup: GGRpc.POST("lookup"),
        tagged: GGRpc.POST("tagged"),
        pair: GGRpc.POST("pair"),
        named: GGRpc.POST("named"),
    },
})
