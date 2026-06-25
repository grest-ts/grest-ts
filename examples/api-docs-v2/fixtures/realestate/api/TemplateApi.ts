import {GGRpc, GGHttpSchema} from "@grest-ts/http";
import {GGFileDownload, GGFileUpload} from "@grest-ts/http-file";
import {FORBIDDEN, GGContractClass, IsArray, IsBit, IsEnum, IsLiteral, IsNumber, IsObject, IsString, IsTuple, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/schema";
import {IsFile} from "@grest-ts/schema-file";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsLanguage, IsTemplateId} from "../Brands";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";

// ---------------------------------------------------------
// Re-export branded ID types
// ---------------------------------------------------------

export type tTemplateId = typeof IsTemplateId.infer

// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum TemplateType {
    custom = "custom",
    welcome = 'welcome',
    contractEnding = "contractEnding",
    contractEnding2 = "contractEnding2",

    invoice = 'invoice',
    invoicePdf = 'invoiceTemplate',

    overdue1InvoiceNotice = "overdueInvoiceNotice",
    overdue2InvoiceThreat = 'overdueInvoiceThreat',
    overdueOnEndedContract = 'overdueOnEndedContract',

    overdue3EvictionWarningNotice = 'evictionWarningNotice',
    overdue4EvictionWarningRepeatedNotice = "evictionWarningRepeatedNotice",

    overdue5EvictionNotice = 'evictionNotice',
    overdue6EvictionRepeatedNotice = "evictionRepeatedNotice",

    taskDelegationEmail = "taskDelegationEmail",
    taskReminderEmail = "taskReminderEmail",
    taskDelegationSms = "taskDelegationSms",
    taskReminderSms = "taskReminderSms",
}

export const IsTemplateType = IsEnum(TemplateType)

// ---------------------------------------------------------
// Type aliases (re-exported as-is)
// ---------------------------------------------------------

export type ContractEndingRelatedEmails = TemplateType.contractEnding
    | TemplateType.contractEnding2

export type InvoiceDebtProcessRelatedEmails = TemplateType.overdue1InvoiceNotice
    | TemplateType.overdue2InvoiceThreat
    | TemplateType.overdueOnEndedContract
    | TemplateType.overdue3EvictionWarningNotice
    | TemplateType.overdue4EvictionWarningRepeatedNotice
    | TemplateType.overdue5EvictionNotice
    | TemplateType.overdue6EvictionRepeatedNotice

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsGetTemplatesQuery = IsObject({
    id: IsTemplateId.orNull.orUndefined,
    type: IsTemplateType.orNull.orUndefined,
    isDefault: IsBit.orNull.orUndefined,
    orderBy: IsObject({
        field: IsLiteral("name", "type", "isDefault"),
        dir: IsLiteral("asc", "desc").orUndefined
    }).orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orUndefined
}).orUndefined
export type GetTemplatesQuery = typeof IsGetTemplatesQuery.infer

export const IsGetTemplatesRow = IsObject({
    id: IsTemplateId,
    type: IsString,
    name: IsString,
    defaultLanguage: IsString,
    languages: IsArray(IsString),
    isDefault: IsLiteral(0, 1).orNull.orUndefined,
    createdByUser: IsString.orUndefined,
    changedByUser: IsString.orUndefined
})

export const IsGetTemplatesResult = IsObject({
    rows: IsArray(IsGetTemplatesRow)
})
export type GetTemplatesResult = typeof IsGetTemplatesResult.infer

export const IsGetTemplateRequest = IsObject({
    id: IsTemplateId
})
export type GetTemplateRequest = typeof IsGetTemplateRequest.infer

export const IsDeleteTemplateRequest = IsObject({
    id: IsTemplateId
})
export type DeleteTemplateRequest = typeof IsDeleteTemplateRequest.infer

export const IsSyncTemplateLanguageFile = IsObject({
    title: IsString,
    file: IsFile.accept('.pdf', '.jpg', '.jpeg', '.png').orUndefined
})

export const IsSyncTemplateLanguage = IsObject({
    language: IsLanguage,
    subject: IsString,
    body: IsString,
    files: IsArray(IsSyncTemplateLanguageFile).orUndefined
})
export type SyncTemplateLanguage = typeof IsSyncTemplateLanguage.infer

export const IsSyncTemplateData = IsObject({
    id: IsTemplateId.orNull.orUndefined,
    type: IsTemplateType,
    name: IsString,
    defaultLanguage: IsLanguage,
    isDefault: IsBit.orNull.default(0),
    languages: IsArray(IsSyncTemplateLanguage),
    createdByUser: IsString.orUndefined,
    changedByUser: IsString.orUndefined
})
export type SyncTemplateData = typeof IsSyncTemplateData.infer

export const IsGetTemplatesForSelectRequest = IsObject({
    type: IsTemplateType.orUndefined
}).orUndefined.default({})
export type GetTemplatesForSelectRequest = typeof IsGetTemplatesForSelectRequest.infer

export const IsTemplateRow = IsObject({
    id: IsTemplateId,
    name: IsString
})

export const IsGetTemplatesForSelectResponse = IsObject({
    rows: IsArray(IsTemplateRow)
})
export type GetTemplatesForSelectResponse = typeof IsGetTemplatesForSelectResponse.infer

export const IsTemplateFileGetRequest = IsObject({
    templateId: IsTemplateId,
    fileName: IsString
})
export type TemplateFileGetRequest = typeof IsTemplateFileGetRequest.infer

export const IsGetSystemTemplateRequest = IsObject({
    type: IsTemplateType
})
export type GetSystemTemplateRequest = typeof IsGetSystemTemplateRequest.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const TemplateApiContract = new GGContractClass("TemplateApi", {
    list: {
        input: IsGetTemplatesQuery,
        success: IsGetTemplatesResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    getForSelect: {
        input: IsGetTemplatesForSelectRequest,
        success: IsGetTemplatesForSelectResponse,
        errors: [NOT_AUTHORIZED, VALIDATION_ERROR, SERVER_ERROR],
    },
    sync: {
        input: IsSyncTemplateData,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    get: {
        input: IsGetTemplateRequest,
        success: IsSyncTemplateData,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    delete: {
        input: IsDeleteTemplateRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    downloadFile: {
        input: IsTemplateFileGetRequest,
        success: IsFile,
        errors: [NOT_AUTHORIZED, NOT_FOUND, VALIDATION_ERROR, SERVER_ERROR],
    },
    getSystemTemplate: {
        input: IsGetSystemTemplateRequest,
        success: IsSyncTemplateData,
        errors: [NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR],
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const TemplateApi = new GGHttpSchema({
    contract: TemplateApiContract,
    pathPrefix: "gg/template",
    use: [GG_USER_AUTH, GG_COMPANY_AUTH_TOKEN],
    routes: {
        list: GGRpc.POST("list"),
        getForSelect: GGRpc.POST("getForSelect"),
        sync: GGFileUpload.POST("sync"),
        get: GGRpc.POST("get"),
        delete: GGRpc.POST("delete"),
        downloadFile: GGFileDownload.GET("downloadFile"),
        getSystemTemplate: GGRpc.POST("getSystemTemplate")
    },
})
