import {GGRpc, GGHttpSchema} from "@grest-ts/http"
import {GGContractClass, IsNumber, IsObject, IsString, SERVER_ERROR} from "@grest-ts/schema"

// Fixture for the request body-size-limit transport feature:
// - echoDefault uses the transport default cap (DEFAULT_MAX_BODY_BYTES)
// - echoSmall tightens it via per-route maxBodyBytes
// - echoBig raises it via per-route maxBodyBytes
export const BodyLimitContract = new GGContractClass("BodyLimit", {
    echoDefault: {
        input: IsObject({data: IsString}),
        success: IsNumber,
        errors: [SERVER_ERROR],
    },
    echoSmall: {
        input: IsObject({data: IsString}),
        success: IsNumber,
        errors: [SERVER_ERROR],
        maxBodyBytes: 1024,
    },
    echoBig: {
        input: IsObject({data: IsString}),
        success: IsNumber,
        errors: [SERVER_ERROR],
        maxBodyBytes: 4 * 1024 * 1024,
    },
})

export const BodyLimitApi = new GGHttpSchema({
    contract: BodyLimitContract,
    pathPrefix: "api/body-limit",
    routes: {
        echoDefault: GGRpc.POST("echo-default"),
        echoSmall: GGRpc.POST("echo-small"),
        echoBig: GGRpc.POST("echo-big"),
    },
})
