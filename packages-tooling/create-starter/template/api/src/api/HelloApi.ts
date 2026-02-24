import {GGContractClass, IsObject, IsString, VALIDATION_ERROR, SERVER_ERROR} from "@grest-ts/schema"
import {httpSchema, GGRpc} from "@grest-ts/http"

// --- Types ---

export const IsHelloRequest = IsObject({
    name: IsString
})
export type HelloRequest = typeof IsHelloRequest.infer

export const IsHelloResponse = IsObject({
    message: IsString
})
export type HelloResponse = typeof IsHelloResponse.infer

// --- Contract ---

export const HelloApiContract = new GGContractClass("HelloApi", {
    hello: {
        input: IsHelloRequest,
        success: IsHelloResponse,
        errors: [VALIDATION_ERROR, SERVER_ERROR]
    }
})

// --- HTTP Schema ---

export const HelloApi = httpSchema(HelloApiContract)
    .pathPrefix("api/hello")
    .routes({
        hello: GGRpc.POST("hello")
    })
