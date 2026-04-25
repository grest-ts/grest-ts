import {GGRpc, httpSchema} from "@grest-ts/http";
import {IsArray, IsObject, IsString, IsNumber, IsEnum, IsLiteral, IsTuple, GGContractClass, FORBIDDEN, NOT_AUTHORIZED, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsApartmentFeatureId, IsApartmentId, IsBuildingId} from "../Brands";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";

// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum ApartmentFeatureType {
    parking = "parking",
    storage = "storage",
    bicycleSpot = "bicycleSpot"
}

export const IsApartmentFeatureType = IsEnum(ApartmentFeatureType)

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsListApartmentFeaturesRequest = IsObject({
    id: IsApartmentFeatureId.orUndefined,
    apartmentId: IsApartmentId,
    orderBy: IsObject({
        field: IsLiteral("name"),
        dir: IsLiteral("asc", "desc").orUndefined
    }).orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orUndefined
})
export type ListApartmentFeaturesRequest = typeof IsListApartmentFeaturesRequest.infer

export const IsListApartmentFeaturesResponseRow = IsObject({
    id: IsApartmentFeatureId,
    apartmentId: IsApartmentId,
    buildingId: IsBuildingId,
    type: IsApartmentFeatureType,
    name: IsString,
    address: IsString
})

export const IsListApartmentFeaturesResponse = IsObject({
    rows: IsArray(IsListApartmentFeaturesResponseRow)
})
export type ListApartmentFeaturesResponse = typeof IsListApartmentFeaturesResponse.infer

export const IsGetApartmentFeaturesRequest = IsObject({
    apartmentId: IsApartmentId.orUndefined
}).orUndefined.default({})
export type GetApartmentFeaturesRequest = typeof IsGetApartmentFeaturesRequest.infer

export const IsApartmentFeatureRow = IsObject({
    id: IsApartmentFeatureId,
    name: IsString
})
export type ApartmentFeatureRow = typeof IsApartmentFeatureRow.infer

export const IsGetApartmentFeaturesResponse = IsObject({
    rows: IsArray(IsApartmentFeatureRow)
})
export type GetApartmentFeaturesResponse = typeof IsGetApartmentFeaturesResponse.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const ApartmentFeaturesApiContract = new GGContractClass("ApartmentFeaturesApi", {
    list: {
        input: IsListApartmentFeaturesRequest,
        success: IsListApartmentFeaturesResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    getForSelect: {
        input: IsGetApartmentFeaturesRequest,
        success: IsGetApartmentFeaturesResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const ApartmentFeaturesApi = httpSchema(ApartmentFeaturesApiContract)
    .pathPrefix("gg/apartmentFeature")
    .use(GG_USER_AUTH)
    .use(GG_COMPANY_AUTH_TOKEN)
    .routes({
        list: GGRpc.POST("list"),
        getForSelect: GGRpc.POST("getForSelect")
    })

