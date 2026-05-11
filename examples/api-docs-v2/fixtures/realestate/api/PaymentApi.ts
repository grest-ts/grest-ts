import {GGRpc, httpSchema} from "@grest-ts/http";
import {IsArray, IsObject, IsString, IsNumber, IsEnum, IsLiteral, IsTuple, GGContractClass, FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR, GGIssueInvalid, GG_NO_PERMISSIONS } from "@grest-ts/schema";
import {IsCreatedAndChangedBy} from "./UserApi";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsClientId, IsContractId, IsDate, IsExpenseId, IsPaymentId, IsUserId} from "../Brands";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";


// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum PaymentType {
    transfer = "transfer",
    cash = "cash",
    expenseCompensation = "expenseCompensation",
    importedTransfer = "importedTransfer",
    debtWriteOff = "debtWriteOff"
}

const IsPaymentType = IsEnum(PaymentType)

// ---------------------------------------------------------
// Type Schemas - Requests
// ---------------------------------------------------------

export const IsPaymentsQuery = IsObject({
    id: IsPaymentId.orNull.orUndefined,
    start: IsDate.orNull.orUndefined,
    end: IsDate.orNull.orUndefined,
    search: IsString.orNull.orUndefined,
    fromClientId: IsClientId.orNull.orUndefined,
    type: IsPaymentType.orNull.orUndefined,
    orderBy: IsObject({
        field: IsLiteral("date", "fromClientName", "type", "title", "sum", "referenceNo", "senderName"),
        dir: IsLiteral("asc", "desc").orUndefined
    }).orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orUndefined
}).orUndefined
export type PaymentsQuery = typeof IsPaymentsQuery.infer

export const IsGetPaymentQuery = IsObject({
    id: IsPaymentId
})
export type GetPaymentQuery = typeof IsGetPaymentQuery.infer

export const IsDeletePaymentQuery = IsObject({
    id: IsPaymentId
})
export type DeletePaymentQuery = typeof IsDeletePaymentQuery.infer

// ---------------------------------------------------------
// Type Schemas - Responses
// ---------------------------------------------------------

export const IsPaymentsResultRow = IsObject({
    id: IsPaymentId,
    type: IsPaymentType,
    fromClientId: IsClientId,
    fromClientName: IsString.orNull,
    contractApartmentAddress: IsString.orNull,
    fromContractId: IsContractId.orNull,
    date: IsString,
    title: IsString,
    senderAccount: IsString.orNull,
    senderName: IsString.orNull,
    referenceNo: IsString.orNull,
    sum: IsNumber
}).merge(IsCreatedAndChangedBy)

export const IsPaymentsResult = IsObject({
    rows: IsArray(IsPaymentsResultRow)
})
export type PaymentsResultRow = typeof IsPaymentsResultRow.infer
export type PaymentsResult = typeof IsPaymentsResult.infer

const paymentSourceError = new GGIssueInvalid("paymentSource", "Either client or contract must be specified");

export const IsSyncPaymentData = IsObject({
    id: IsPaymentId.orNull.orUndefined,
    date: IsString,
    type: IsPaymentType,
    sum: IsNumber,
    title: IsString,
    isRelatedToContract: IsLiteral(0, 1),
    fromClientId: IsClientId.orNull.orUndefined,
    fromContractId: IsContractId.orNull.orUndefined,
    compensatedExpenseId: IsExpenseId.orNull.orUndefined,
    bankPaymentId: IsString.orNull.orUndefined,
    senderBankCode: IsString.orNull.orUndefined,
    senderAccount: IsString.orNull.orUndefined,
    senderName: IsString.orNull.orUndefined,
    initialSenderName: IsString.orNull.orUndefined,
    referenceNo: IsString.orNull.orUndefined,
    createdByUserId: IsUserId.orNull.orUndefined,
    changedByUserId: IsUserId.orNull.orUndefined
})
    .refine(obj => !!(obj.fromClientId || obj.fromContractId), paymentSourceError)
export type SyncPaymentData = typeof IsSyncPaymentData.infer

export const IsSyncPaymentResult = IsObject({
    id: IsPaymentId
})
export type SyncPaymentResult = typeof IsSyncPaymentResult.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const PaymentApiContract = new GGContractClass("PaymentApi", {
    list: {
        input: IsPaymentsQuery,
        success: IsPaymentsResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    get: {
        input: IsGetPaymentQuery,
        success: IsSyncPaymentData,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    sync: {
        input: IsSyncPaymentData,
        success: IsSyncPaymentResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    delete: {
        input: IsDeletePaymentQuery,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const PaymentApi = httpSchema(PaymentApiContract)
    .pathPrefix("gg/payment")
    .use(GG_USER_AUTH)
    .use(GG_COMPANY_AUTH_TOKEN)
    .routes({
        list: GGRpc.POST("list"),
        get: GGRpc.POST("get"),
        sync: GGRpc.POST("sync"),
        delete: GGRpc.POST("delete")
    })

