import {GGRpc, httpSchema} from "@grest-ts/http";
import {IsArray, IsObject, IsString, IsNumber, IsLiteral, IsTuple, GGContractClass, FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsApartmentId, IsDate, IsOwnerExpenseId, IsUserId} from "../Brands";
import {IsOwnerId} from "./OwnerApi";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";


// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsOwnerExpenseQuery = IsObject({
    id: IsOwnerExpenseId.orNull.orUndefined,
    start: IsDate.orNull.orUndefined,
    end: IsDate.orNull.orUndefined,
    apartmentId: IsApartmentId.orNull.orUndefined,
    ownerId: IsOwnerId.orNull.orUndefined,
    orderBy: IsObject({
        field: IsLiteral("date", "apartmentAddress", "sum", "ownerName", "title"),
        dir: IsLiteral("asc", "desc").orUndefined
    }).orNull.orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orNull.orUndefined
})
export type OwnerExpenseQuery = typeof IsOwnerExpenseQuery.infer

export const IsOwnerExpenseResultRow = IsObject({
    id: IsOwnerExpenseId,
    apartmentId: IsApartmentId,
    apartmentAddress: IsString,
    ownerId: IsOwnerId,
    ownerName: IsString,
    date: IsDate,
    sum: IsNumber,
    title: IsString,
    created: IsString,
    createdByUserId: IsUserId,
    createdByUser: IsString,
    changed: IsString,
    changedByUserId: IsUserId,
    changedByUser: IsString
})

export const IsOwnerExpenseResult = IsObject({
    rows: IsArray(IsOwnerExpenseResultRow)
})
export type OwnerExpenseResultRow = typeof IsOwnerExpenseResultRow.infer
export type OwnerExpenseResult = typeof IsOwnerExpenseResult.infer

export const IsGetOwnerExpenseQuery = IsObject({
    id: IsOwnerExpenseId
})
export type GetOwnerExpenseQuery = typeof IsGetOwnerExpenseQuery.infer

export const IsSyncOwnerExpenseData = IsObject({
    id: IsOwnerExpenseId.orUndefined,
    apartmentId: IsApartmentId,
    ownerId: IsOwnerId.orNull.orUndefined,
    date: IsDate,
    sum: IsNumber,
    title: IsString
})
export type SyncOwnerExpenseData = typeof IsSyncOwnerExpenseData.infer

export const IsSyncOwnerExpenseResult = IsObject({
    id: IsOwnerExpenseId
})
export type SyncOwnerExpenseResult = typeof IsSyncOwnerExpenseResult.infer

export const IsDeleteOwnerExpenseQuery = IsObject({
    id: IsOwnerExpenseId
})
export type DeleteOwnerExpenseQuery = typeof IsDeleteOwnerExpenseQuery.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const OwnerExpenseApiContract = new GGContractClass("OwnerExpenseApi", {
    list: {
        input: IsOwnerExpenseQuery,
        success: IsOwnerExpenseResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    get: {
        input: IsGetOwnerExpenseQuery,
        success: IsSyncOwnerExpenseData,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    sync: {
        input: IsSyncOwnerExpenseData,
        success: IsSyncOwnerExpenseResult,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    delete: {
        input: IsDeleteOwnerExpenseQuery,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const OwnerExpenseApi = httpSchema(OwnerExpenseApiContract)
    .pathPrefix("gg/ownerExpense")
    .use(GG_USER_AUTH)
    .use(GG_COMPANY_AUTH_TOKEN)
    .routes({
        list: GGRpc.POST("list"),
        get: GGRpc.POST("get"),
        sync: GGRpc.POST("sync"),
        delete: GGRpc.POST("delete")
    })

