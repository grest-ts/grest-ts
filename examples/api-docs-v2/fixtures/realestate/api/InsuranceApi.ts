import {GGRpc, GGHttpSchema} from "@grest-ts/http";
import {IsObject, IsString, IsNumber, GGContractClass, FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/schema";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsApartmentId, IsDate, IsExpenseId, IsExpenseRowId, IsInsuranceId, IsUserId} from "../Brands";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";


// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsGetInsuranceQuery = IsObject({
    id: IsInsuranceId
})
export type GetInsuranceQuery = typeof IsGetInsuranceQuery.infer

export const IsDeleteInsuranceQuery = IsObject({
    id: IsInsuranceId
})
export type DeleteInsuranceQuery = typeof IsDeleteInsuranceQuery.infer

export const IsSyncInsuranceData = IsObject({
    id: IsInsuranceId.orUndefined,
    apartmentId: IsApartmentId,
    apartmentAddress: IsString.orUndefined,
    expenseId: IsExpenseId.orNull,
    expenseRowId: IsExpenseRowId.orNull,
    periodStart: IsDate,
    periodEnd: IsDate,
    sum: IsNumber,
    vat: IsNumber.orNull,
    sumWithVat: IsNumber,
    changedByUserId: IsUserId.orUndefined,
    createdByUserId: IsUserId.orUndefined
})
export type SyncInsuranceData = typeof IsSyncInsuranceData.infer

export const IsSyncInsuranceResult = IsObject({
    id: IsInsuranceId
})
export type SyncInsuranceResult = typeof IsSyncInsuranceResult.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const InsuranceApiContract = new GGContractClass("InsuranceApi", {
    get: {
        input: IsGetInsuranceQuery,
        success: IsSyncInsuranceData,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    sync: {
        input: IsSyncInsuranceData,
        success: IsSyncInsuranceResult,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    delete: {
        input: IsDeleteInsuranceQuery,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const InsuranceApi = new GGHttpSchema({
    contract: InsuranceApiContract,
    pathPrefix: "gg/insurance",
    use: [GG_USER_AUTH, GG_COMPANY_AUTH_TOKEN],
    routes: {
        get: GGRpc.POST("get"),
        sync: GGRpc.POST("sync"),
        delete: GGRpc.POST("delete")
    },
})

