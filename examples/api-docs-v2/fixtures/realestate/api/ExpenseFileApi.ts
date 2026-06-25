import {GGRpc, GGHttpSchema} from "@grest-ts/http";
import {GGFileDownload, GGFileUpload} from "@grest-ts/http-file";
import {FORBIDDEN, GGContractClass, IsArray, IsBoolean, IsEnum, IsLiteral, IsNumber, IsObject, IsString, IsTuple, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/schema";
import {IsFile} from "@grest-ts/schema-file";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsApartmentId, IsDate, IsEmailId, IsExpenseFileId, IsExpenseId, IsUserId} from "../Brands";
import {IsExpenseType} from "./ExpenseApi";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";

// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum ExpenseFileState {
    waiting = "waiting",
    handled = "handled",
    ignored = "ignored"
}

export enum FileSource {
    upload = "upload",
    email = "email"
}

export enum ExpenseFileIssueState {
    waiting = "waiting",
    fixed = "fixed",
    ignored = "ignored"
}

const IsExpenseFileState = IsEnum(ExpenseFileState)
const IsFileSource = IsEnum(FileSource)

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsFileQuery = IsObject({
    id: IsExpenseFileId.orNull.orUndefined,
    search: IsString.orNull.orUndefined,
    state: IsExpenseFileState.orNull.orUndefined,
    start: IsDate.orNull.orUndefined,
    end: IsDate.orNull.orUndefined,
    orderBy: IsObject({
        field: IsLiteral("created", "title"),
        dir: IsLiteral("asc", "desc").orUndefined
    }).orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orUndefined
})
export type FileQuery = typeof IsFileQuery.infer

export const IsFileQueryResponseRow = IsObject({
    id: IsExpenseFileId,
    created: IsString,
    title: IsString,
    state: IsExpenseFileState,
    source: IsFileSource,
    expenseId: IsExpenseId.orNull.orUndefined,
    expenseEmailId: IsEmailId.orNull.orUndefined,
    emailFrom: IsString.orNull.orUndefined,
    emailTitle: IsString.orNull.orUndefined,
    fileName: IsString,
    size: IsNumber,
    createdByUserId: IsUserId.orNull.orUndefined,
    createdByUserName: IsString.orUndefined
})
export type FileQueryResponseRow = typeof IsFileQueryResponseRow.infer

export const IsFileQueryResponse = IsObject({
    rows: IsArray(IsFileQueryResponseRow)
})
export type FileQueryResponse = typeof IsFileQueryResponse.infer

export const IsFileGetRequest = IsObject({
    id: IsExpenseFileId
})
export type FileGetRequest = typeof IsFileGetRequest.infer

export const IsFileSyncRequest = IsObject({
    id: IsExpenseFileId,
    state: IsExpenseFileState
})
export type FileSyncRequest = typeof IsFileSyncRequest.infer

export const IsFileDeleteRequest = IsObject({
    id: IsExpenseFileId
})
export type FileDeleteRequest = typeof IsFileDeleteRequest.infer

export const IsFileUploadRequest = IsObject({
    files: IsArray(IsFile.accept('.pdf'))
})
export type FileUploadRequest = typeof IsFileUploadRequest.infer

export const IsParseFileRequest = IsObject({
    id: IsExpenseFileId,
    force: IsBoolean
})
export type ParseFileRequest = typeof IsParseFileRequest.infer

export const IsReportExpenseFileIssue = IsObject({
    id: IsExpenseFileId,
    comment: IsString
})
export type ReportExpenseFileIssue = typeof IsReportExpenseFileIssue.infer

export const IsInvoiceParserResultRow = IsObject({
    title: IsString,
    sum: IsNumber,
    vat: IsNumber.orNull,
    vatSum: IsNumber,
    sumWithVat: IsNumber,
    type: IsExpenseType,
    apartmentAddress: IsString.orUndefined,
    apartmentId: IsApartmentId.orNull.orUndefined
})
export type InvoiceParserResultRow = typeof IsInvoiceParserResultRow.infer

export const IsInvoiceParserResult = IsObject({
    date: IsDate,
    dueDate: IsDate,
    invoiceNo: IsString,
    referenceNo: IsString.orUndefined,
    country: IsString,
    clientName: IsString,
    clientRegCode: IsString,
    clientVatNo: IsString.orUndefined,
    clientAccounts: IsArray(IsString),
    sum: IsNumber,
    vatSum: IsNumber,
    sumWithVat: IsNumber,
    rounding: IsNumber,
    rows: IsArray(IsInvoiceParserResultRow),
    parser: IsString.orUndefined,
    parserDebugData: IsString.orUndefined
})
export type InvoiceParserResult = typeof IsInvoiceParserResult.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const ExpenseFileApiContract = new GGContractClass("ExpenseFileApi", {
    list: {
        input: IsFileQuery,
        success: IsFileQueryResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    get: {
        input: IsFileGetRequest,
        success: IsFileQueryResponseRow,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    sync: {
        input: IsFileSyncRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    delete: {
        input: IsFileDeleteRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    upload: {
        input: IsFileUploadRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    download: {
        input: IsFileGetRequest,
        success: IsFile,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    parseExpenseFromFile: {
        input: IsParseFileRequest,
        success: IsInvoiceParserResult,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    reportIssue: {
        input: IsReportExpenseFileIssue,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const ExpenseFileApi = new GGHttpSchema({
    contract: ExpenseFileApiContract,
    pathPrefix: "gg/expenseFile",
    use: [GG_USER_AUTH, GG_COMPANY_AUTH_TOKEN],
    routes: {
        list: GGRpc.POST("list"),
        get: GGRpc.POST("get"),
        sync: GGRpc.POST("sync"),
        delete: GGRpc.POST("delete"),
        upload: GGFileUpload.POST("upload"),
        download: GGFileDownload.GET("download"),
        parseExpenseFromFile: GGRpc.POST("parseExpenseFromFile"),
        reportIssue: GGRpc.POST("reportIssue")
    },
})

