import {GGRpc, httpSchema} from "@grest-ts/http";
import {IsArray, IsObject, IsString, IsNumber, IsEnum, IsBit, IsLiteral, IsTuple, IsPartialRecord, IsRecord, GGContractClass, FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsBankIntegrationId, IsCountry2, IsEmail, IsRegCode, IsVatNo, regCodeError, vatCodeError} from "../Brands";
import {BankIntegrationType} from "./BankIntegrationApi";
import {isValidVatCode} from "../common/isValidVatCode";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";
import {isValidCompanyCode} from "../common/isValidCompanyCode";

// ---------------------------------------------------------
// Type Schemas - IDs
// ---------------------------------------------------------

export const IsCompanyId = IsNumber.brand("CompanyId");
export type tCompanyId = typeof IsCompanyId.infer

export const IsFileEmailId = IsNumber.brand("FileEmailId");
export type tFileEmailId = typeof IsFileEmailId.infer

export const IsBookkeepingIntegrationId = IsNumber.brand("BookkeepingIntegrationId");
export type tBookkeepingIntegrationId = typeof IsBookkeepingIntegrationId.infer

// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum CompanyState {
    ACTIVE = "active",
    HIDDEN = "hidden"
}

const IsCompanyState = IsEnum(CompanyState)

export enum InvoiceDateType {
    generationDay = "generationDay",
    rentMonthFirstDay = "rentMonthFirstDay"
}

const IsInvoiceDateType = IsEnum(InvoiceDateType)

export enum BookkeepingApplication {
    merit = "merit",
    simplBooks = "simplBooks"
}

const IsBookkeepingApplication = IsEnum(BookkeepingApplication)

// ---------------------------------------------------------
// Type Schemas - Common
// ---------------------------------------------------------

// Branded types imported from Brands

// ---------------------------------------------------------
// Article Code Config types (stored as JSON on company)
// ---------------------------------------------------------

const IsInvoiceArticleKey = IsLiteral("rent", "parking", "storage", "bicycleSpot", "expense", "custom", "deposit", "sales", "compensation")
const IsExpenseArticleKey = IsLiteral("electricity_network", "electricity", "utilities", "utilities_opt", "insurance", "contractFee", "other", "notary", "maintenance")

export const IsArticleCodeVatPair = IsObject({
    noVat: IsString.orNull,
    withVat: IsString.orNull
})
export type ArticleCodeVatPair = typeof IsArticleCodeVatPair.infer

export const IsArticleCodeRuleset = IsObject({
    invoice: IsPartialRecord(IsInvoiceArticleKey, IsArticleCodeVatPair).orUndefined,
    expense: IsPartialRecord(IsExpenseArticleKey, IsArticleCodeVatPair).orUndefined
})
export type ArticleCodeRuleset = typeof IsArticleCodeRuleset.infer

export const IsArticleCodeSet = IsObject({
    startingFrom: IsString,
    default: IsArticleCodeRuleset,
    buildings: IsRecord(IsString, IsArticleCodeRuleset).orUndefined,
    apartments: IsRecord(IsString, IsArticleCodeRuleset).orUndefined
})
export type ArticleCodeSet = typeof IsArticleCodeSet.infer

export const IsArticleCodeConfig = IsArray(IsArticleCodeSet)
export type ArticleCodeConfig = typeof IsArticleCodeConfig.infer

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsCompanyGetRequest = IsObject({
    id: IsCompanyId
})
export type CompanyGetRequest = typeof IsCompanyGetRequest.infer

export const IsFileEmailPrefix = IsObject({
    id: IsFileEmailId.orNull.orUndefined,
    name: IsString
})
export type FileEmailPrefix = typeof IsFileEmailPrefix.infer

export const IsBankIntegrationEntry = IsObject({
    id: IsBankIntegrationId.orNull.orUndefined,
    type: IsEnum(BankIntegrationType),
    clientCode: IsString,
    clientCountry: IsString,
    accountNo: IsString,
})
export type BankIntegrationEntry = typeof IsBankIntegrationEntry.infer

export const IsBookkeepingIntegration = IsObject({
    id: IsBookkeepingIntegrationId.orNull.orUndefined,
    name: IsString,
    application: IsBookkeepingApplication,
    apiId: IsString,
    apiKey: IsString,
    isActive: IsBit.default(0)
})
export type BookkeepingIntegration = typeof IsBookkeepingIntegration.infer

export const IsCompany = IsObject({
    id: IsCompanyId,
    createdTs: IsNumber.orUndefined,
    name: IsString,
    country: IsCountry2,
    state: IsCompanyState,
    replyToEmail: IsEmail,
    bccEmail: IsEmail.orNull.orUndefined,
    fromEmailSubdomain: IsString.orNull.orUndefined,
    invoiceName: IsString,
    invoiceAddress: IsString,
    invoiceRegNo: IsRegCode,
    invoiceVatNo: IsVatNo.orNull.orUndefined,
    invoiceAccount1: IsString,
    invoiceDateType: IsInvoiceDateType,
    bookkeepingPrivateClientPrefix: IsString.orNull.orUndefined,
    expenseEmailAddresses: IsArray(IsFileEmailPrefix).maxLength(5).orNull.orUndefined,
    bookkeepingIntegrations: IsArray(IsBookkeepingIntegration).orUndefined,
    bankIntegrations: IsArray(IsBankIntegrationEntry).orUndefined,
    articleCodeConfig: IsArticleCodeConfig.orNull.orUndefined,
})
    .refine(obj => isValidCompanyCode(obj.invoiceRegNo, "EE"), regCodeError)
    .refine(obj => isValidVatCode(obj.invoiceVatNo, "EE"), vatCodeError)
export type Company = typeof IsCompany.infer

export const IsCreateCompanyInput = IsObject({
    name: IsString,
    country: IsCountry2,
    state: IsCompanyState,
    replyToEmail: IsEmail,
    bccEmail: IsEmail.orNull.orUndefined,
    fromEmailSubdomain: IsString.orNull.orUndefined,
    invoiceName: IsString,
    invoiceAddress: IsString,
    invoiceRegNo: IsRegCode,
    invoiceVatNo: IsVatNo.orNull.orUndefined,
    invoiceAccount1: IsString,
    invoiceDateType: IsInvoiceDateType,
    bookkeepingPrivateClientPrefix: IsString.orNull.orUndefined,
    expenseEmailAddresses: IsArray(IsFileEmailPrefix).maxLength(5).orNull.orUndefined,
    bookkeepingIntegrations: IsArray(IsBookkeepingIntegration).orUndefined,
    bankIntegrations: IsArray(IsBankIntegrationEntry).orUndefined,
    articleCodeConfig: IsArticleCodeConfig.orNull.orUndefined,
})
    .refine(obj => isValidCompanyCode(obj.invoiceRegNo, "EE"), regCodeError)
    .refine(obj => isValidVatCode(obj.invoiceVatNo, "EE"), vatCodeError)
export type CreateCompanyInput = typeof IsCreateCompanyInput.infer

export const IsCreateCompanyResult = IsObject({
    id: IsCompanyId
})
export type CreateCompanyResult = typeof IsCreateCompanyResult.infer

export const IsCompanyRow = IsObject({
    id: IsCompanyId,
    name: IsString
})
export type CompanyRow = typeof IsCompanyRow.infer

export const IsCompanyGetForSelectResponse = IsObject({
    rows: IsArray(IsCompanyRow)
})
export type CompanyGetForSelectResponse = typeof IsCompanyGetForSelectResponse.infer

export const IsCompanyListQuery = IsObject({
    search: IsString.orNull.orUndefined,
    orderBy: IsObject({
        field: IsLiteral("name", "state", "country").orUndefined,
        dir: IsLiteral("asc", "desc").orUndefined
    }).orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orUndefined
}).orUndefined
export type CompanyListQuery = typeof IsCompanyListQuery.infer

export const IsCompanyListRow = IsObject({
    id: IsCompanyId,
    name: IsString,
    state: IsCompanyState,
    country: IsString
})
export type CompanyListRow = typeof IsCompanyListRow.infer

export const IsCompanyListResponse = IsObject({
    rows: IsArray(IsCompanyListRow)
})
export type CompanyListResponse = typeof IsCompanyListResponse.infer

export const IsDeleteFileEmailRequest = IsObject({
    id: IsFileEmailId
})
export type DeleteFileEmailRequest = typeof IsDeleteFileEmailRequest.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const CompanyApiContract = new GGContractClass("CompanyApi", {
    list: {
        input: IsCompanyListQuery,
        success: IsCompanyListResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    getForSelect: {
        success: IsCompanyGetForSelectResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    get: {
        input: IsCompanyGetRequest,
        success: IsCompany,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    create: {
        input: IsCreateCompanyInput,
        success: IsCreateCompanyResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    update: {
        input: IsCompany,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    deleteFileEmail: {
        input: IsDeleteFileEmailRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const CompanyApi = httpSchema(CompanyApiContract)
    .pathPrefix("gg/company")
    .use(GG_USER_AUTH)
    .use(GG_COMPANY_AUTH_TOKEN)
    .routes({
        list: GGRpc.POST("list"),
        getForSelect: GGRpc.POST("getForSelect"),
        get: GGRpc.POST("get"),
        create: GGRpc.POST("create"),
        update: GGRpc.POST("update"),
        deleteFileEmail: GGRpc.POST("deleteFileEmail")
    })

