import {GGRpc, GGHttpSchema} from "@grest-ts/http";
import {IsArray, IsObject, IsString, IsNumber, IsEnum, IsLiteral, IsTuple, GGContractClass, FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/schema";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsApartmentId, IsClientId, IsContractId, IsDate, IsInvoiceFutureRowId, IsInvoiceId, IsUserId} from "../Brands";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";


// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

// Subset of InvoiceRowType used by FutureRows
export enum InvoiceFutureRowType {
    sales = "sales",
    compensation = "compensation"
}

export const IsInvoiceFutureRowType = IsEnum(InvoiceFutureRowType)

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsInvoiceFutureRowQuery = IsObject({
    id: IsInvoiceFutureRowId.orUndefined,
    start: IsDate.orUndefined,
    end: IsDate.orUndefined,
    contractId: IsContractId.orUndefined,
    orderBy: IsObject({
        field: IsLiteral("date", "apartmentAddress", "clientName", "sum", "title", "vat", "sumWithVat"),
        dir: IsLiteral("asc", "desc").orUndefined
    }).orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orUndefined
})
export type InvoiceFutureRowQuery = typeof IsInvoiceFutureRowQuery.infer

export const IsInvoiceFutureRowResultRow = IsObject({
    id: IsInvoiceFutureRowId,
    contractId: IsContractId,
    clientId: IsClientId,
    clientName: IsString,
    apartmentId: IsApartmentId,
    apartmentAddress: IsString,
    date: IsDate,
    sum: IsNumber,
    vat: IsNumber.orNull,
    sumWithVat: IsNumber,
    title: IsString,
    type: IsInvoiceFutureRowType,
    created: IsString,
    createdByUserId: IsUserId,
    createdByUser: IsString,
    changed: IsString,
    changedByUserId: IsUserId,
    changedByUser: IsString
})

export const IsInvoiceFutureRowResult = IsObject({
    rows: IsArray(IsInvoiceFutureRowResultRow)
})
export type InvoiceFutureRowResultRow = typeof IsInvoiceFutureRowResultRow.infer
export type InvoiceFutureRowResult = typeof IsInvoiceFutureRowResult.infer

export const IsGetInvoiceFutureRowQuery = IsObject({
    id: IsInvoiceFutureRowId
})
export type GetInvoiceFutureRowQuery = typeof IsGetInvoiceFutureRowQuery.infer

export const IsSyncInvoiceFutureRowData = IsObject({
    id: IsInvoiceFutureRowId.orNull.orUndefined,
    contractId: IsContractId,
    date: IsDate,
    sum: IsNumber,
    vat: IsNumber.orNull,
    sumWithVat: IsNumber,
    title: IsString,
    articleCode: IsString.orNull.orUndefined,
    type: IsInvoiceFutureRowType,
    companyHasVat: IsLiteral(0, 1).orNull.orUndefined,
    invoiceNo: IsString.orNull.orUndefined,
    invoiceId: IsInvoiceId.orNull.orUndefined,
    invoiceDate: IsDate.orNull.orUndefined
})
export type SyncInvoiceFutureRowData = typeof IsSyncInvoiceFutureRowData.infer

export const IsSyncInvoiceFutureRowResult = IsObject({
    id: IsInvoiceFutureRowId
})
export type SyncInvoiceFutureRowResult = typeof IsSyncInvoiceFutureRowResult.infer

export const IsDeleteInvoiceFutureRowQuery = IsObject({
    id: IsInvoiceFutureRowId
})
export type DeleteInvoiceFutureRowQuery = typeof IsDeleteInvoiceFutureRowQuery.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const InvoiceFutureRowApiContract = new GGContractClass("InvoiceFutureRowApi", {
    list: {
        input: IsInvoiceFutureRowQuery,
        success: IsInvoiceFutureRowResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    get: {
        input: IsGetInvoiceFutureRowQuery,
        success: IsSyncInvoiceFutureRowData,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    sync: {
        input: IsSyncInvoiceFutureRowData,
        success: IsSyncInvoiceFutureRowResult,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    delete: {
        input: IsDeleteInvoiceFutureRowQuery,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const InvoiceFutureRowApi = new GGHttpSchema({
    contract: InvoiceFutureRowApiContract,
    pathPrefix: "gg/invoiceFutureRow",
    use: [GG_USER_AUTH, GG_COMPANY_AUTH_TOKEN],
    routes: {
        list: GGRpc.POST("list"),
        get: GGRpc.POST("get"),
        sync: GGRpc.POST("sync"),
        delete: GGRpc.POST("delete")
    },
})

