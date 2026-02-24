import {GGRpc, httpSchema} from "@grest-ts/http"
import {GGContractClass, IsObject, IsString, VALIDATION_ERROR} from "@grest-ts/schema";

// ---------------------------------------------------------
// Type Schemas
// ---------------------------------------------------------

export const IsBenchmarkRequest = IsObject({
    name: IsString
})
export type BenchmarkRequest = typeof IsBenchmarkRequest.infer

export const IsBenchmarkResponse = IsObject({
    res: IsString
})
export type BenchmarkResponse = typeof IsBenchmarkResponse.infer

// ---------------------------------------------------------
// Contract & API Interface
// ---------------------------------------------------------

export const BenchmarkApiContract = new GGContractClass("BenchmarkApi", {
    hello: {
        input: IsBenchmarkRequest,
        success: IsBenchmarkResponse,
        errors: [VALIDATION_ERROR]
    }
})

export const BenchmarkApi = httpSchema(BenchmarkApiContract)
    .pathPrefix("api/benchmark")
    .routes({
        hello: GGRpc.GET("hello")
    })
