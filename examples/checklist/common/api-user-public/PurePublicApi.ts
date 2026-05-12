import {GGRpc, httpSchema} from "@grest-ts/http"
import {GGContractClass, IsBoolean, IsObject, SERVER_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";

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
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    }
})

export const StatusApi = httpSchema(PurePublicApiContract)
    .pathPrefix("status")
    .routes({
        status: GGRpc.GET("status")
    })
