import {GGRpc, GGHttpSchema} from "@grest-ts/http";
import {IsObject, IsString, IsNumber, GGContractClass, FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/schema";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsExpenseId, IsExpenseRowId, IsContractId} from "../Brands";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";

// ---------------------------------------------------------
// Type Schemas - IDs
// ---------------------------------------------------------

export const IsExpenseCompensationId = IsNumber.brand("ExpenseCompensationId");
export type tExpenseCompensationId = typeof IsExpenseCompensationId.infer

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsGetExpenseCompensationQuery = IsObject({
    id: IsExpenseCompensationId
})
export type GetExpenseCompensationQuery = typeof IsGetExpenseCompensationQuery.infer

export const IsDeleteExpenseCompensationRequest = IsObject({
    id: IsExpenseCompensationId
})
export type DeleteExpenseCompensationRequest = typeof IsDeleteExpenseCompensationRequest.infer

export const IsSyncExpenseCompensationData = IsObject({
    id: IsExpenseCompensationId.orNull.orUndefined,
    date: IsString,
    sum: IsNumber,
    vat: IsNumber.orNull,
    sumWithVat: IsNumber,
    contractId: IsContractId,
    titleToInvoice: IsString,
    expenseRowId: IsExpenseRowId,
    expenseId: IsExpenseId.orNull.orUndefined
})
export type SyncExpenseCompensationData = typeof IsSyncExpenseCompensationData.infer

export const IsSyncExpenseCompensationResult = IsObject({
    id: IsExpenseCompensationId
})
export type SyncExpenseCompensationResult = typeof IsSyncExpenseCompensationResult.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const ExpenseCompensationApiContract = new GGContractClass("ExpenseCompensationApi", {
    get: {
        input: IsGetExpenseCompensationQuery,
        success: IsSyncExpenseCompensationData,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    sync: {
        input: IsSyncExpenseCompensationData,
        success: IsSyncExpenseCompensationResult,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    delete: {
        input: IsDeleteExpenseCompensationRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const ExpenseCompensationApi = new GGHttpSchema({
    contract: ExpenseCompensationApiContract,
    pathPrefix: "gg/expenseCompensation",
    use: [GG_USER_AUTH, GG_COMPANY_AUTH_TOKEN],
    routes: {
        get: GGRpc.POST("get"),
        sync: GGRpc.POST("sync"),
        delete: GGRpc.POST("delete")
    },
})

