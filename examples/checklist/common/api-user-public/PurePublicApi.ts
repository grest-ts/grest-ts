import {GGRpc, httpSchema} from "@grest-ts/http"
import {GGContractClass, IsBoolean, IsObject, SERVER_ERROR} from "@grest-ts/schema";

// ---------------------------------------------------------
// Type Schemas
// ---------------------------------------------------------

export const IsStatusResponse = IsObject({
    status: IsBoolean
})

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const PurePublicApiContract = new GGContractClass("PurePublicApi", {
    status: {
        success: IsStatusResponse,
        errors: [SERVER_ERROR]
    }
})

export const StatusApi = httpSchema(PurePublicApiContract)
    .pathPrefix("status")
    .routes({
        status: GGRpc.GET("status")
    })
