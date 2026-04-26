import {GGRpc, httpSchema} from "@grest-ts/http";
import {FORBIDDEN, GGContractClass, IsArray, IsDiscriminated, IsEmail, IsEnum, IsLiteral, IsNumber, IsObject, IsString, IsTuple, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsCountry2, IsVatNo, regCodeError, vatCodeError} from "../Brands";
import {isValidVatCode} from "../common/isValidVatCode";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";
import {isValidPersonCode} from "../common/isValidPersonCode";
import {isValidCompanyCode} from "../common/isValidCompanyCode";

// ---------------------------------------------------------
// Type Schemas - IDs
// ---------------------------------------------------------

export const IsOwnerId = IsNumber.brand("OwnerId");
export type tOwnerId = typeof IsOwnerId.infer

// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum OwnerType {
    business = "business",
    person = "person"
}

const IsOwnerType = IsEnum(OwnerType)

// Branded types imported from Brands

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsOwnerApiGetForSelectRequest = IsObject({
    search: IsString.orUndefined
}).orUndefined.default({})
export type OwnerApiGetForSelectRequest = typeof IsOwnerApiGetForSelectRequest.infer

export const IsOwnerRow = IsObject({
    id: IsOwnerId,
    name: IsString
})
export type OwnerRow = typeof IsOwnerRow.infer

export const IsOwnerApiGetForSelectResponse = IsObject({
    rows: IsArray(IsOwnerRow)
})
export type OwnerApiGetForSelectResponse = typeof IsOwnerApiGetForSelectResponse.infer

export const IsOwnerApiGetRequest = IsObject({
    id: IsOwnerId
})
export type OwnerApiGetRequest = typeof IsOwnerApiGetRequest.infer

export const IsOwnerApiDeleteRequest = IsObject({
    id: IsOwnerId
})
export type OwnerApiDeleteRequest = typeof IsOwnerApiDeleteRequest.infer

export const IsOwnersQuery = IsObject({
    id: IsOwnerId.orNull.orUndefined,
    search: IsString.orNull.orUndefined,
    orderBy: IsObject({
        field: IsLiteral("name", "code", "email", "phone", "bookkeepingEmail"),
        dir: IsLiteral("asc", "desc").orUndefined
    }).orNull.orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orNull.orUndefined
}).orUndefined
export type OwnersQuery = typeof IsOwnersQuery.infer

export const IsOwnersResultRow = IsObject({
    id: IsOwnerId,
    name: IsString,
    type: IsOwnerType,
    code: IsString.orNull.orUndefined,
    email: IsString.orNull.orUndefined,
    bookkeepingEmail: IsString.orNull.orUndefined,
    phone: IsString.orNull.orUndefined,
    managementFeePercentage: IsNumber.orNull.orUndefined,
    created: IsString.orUndefined,
    changed: IsString.orUndefined
})

export const IsOwnersResult = IsObject({
    query: IsOwnersQuery,
    rows: IsArray(IsOwnersResultRow)
})
export type OwnersResultRow = typeof IsOwnersResultRow.infer
export type OwnersResult = typeof IsOwnersResult.infer

const IsOwnerBase = IsObject({
    id: IsOwnerId.orUndefined,
    name: IsString,
    country: IsCountry2,
    phone: IsString.orNull,
    email: IsEmail.orNull,
    managementFeePercentage: IsNumber.orNull,
    bookkeepingEmail: IsString.orNull,
    address: IsString.orNull,
    invoiceAccount1: IsString.orNull,
    comment: IsString.orNull,
    created: IsString.orUndefined,
    createdByUserId: IsNumber.orUndefined,
    createdByUser: IsString.orUndefined,
    changed: IsString.orUndefined,
    changedByUserId: IsNumber.orUndefined,
    changedByUser: IsString.orUndefined
})

const IsBusinessOwnerData = IsOwnerBase.merge(IsObject({
    type: OwnerType.business as const,
    code: IsString.trim.orNull.orUndefined,
    vatNo: IsVatNo.orNull.orUndefined,
}))
    .refine(obj => !obj.code || isValidCompanyCode(obj.code, obj.country), regCodeError)
    .refine(obj => isValidVatCode(obj.vatNo, obj.country), vatCodeError)

const IsPersonOwnerData = IsOwnerBase.merge(IsObject({
    type: OwnerType.person as const,
    code: IsString.trim.orNull.orUndefined,
}))
    .refine(obj => !obj.code || isValidPersonCode(obj.code, obj.country), regCodeError)

export const IsSyncOwnerData = IsDiscriminated("type", {
    [OwnerType.business]: IsBusinessOwnerData,
    [OwnerType.person]: IsPersonOwnerData,
})
export type SyncOwnerData = typeof IsSyncOwnerData.infer

export const IsOwnerSyncResponse = IsObject({
    id: IsOwnerId
})
export type OwnerSyncResponse = typeof IsOwnerSyncResponse.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const OwnerApiContract = new GGContractClass("OwnerApi", {
    getForSelect: {
        input: IsOwnerApiGetForSelectRequest,
        success: IsOwnerApiGetForSelectResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    list: {
        input: IsOwnersQuery,
        success: IsOwnersResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    get: {
        input: IsOwnerApiGetRequest,
        success: IsSyncOwnerData,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    delete: {
        input: IsOwnerApiDeleteRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    sync: {
        input: IsSyncOwnerData,
        success: IsOwnerSyncResponse,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const OwnerApi = httpSchema(OwnerApiContract)
    .pathPrefix("gg/owner")
    .use(GG_USER_AUTH)
    .use(GG_COMPANY_AUTH_TOKEN)
    .routes({
        getForSelect: GGRpc.POST("getForSelect"),
        list: GGRpc.POST("list"),
        get: GGRpc.POST("get"),
        delete: GGRpc.POST("delete"),
        sync: GGRpc.POST("sync")
    })

