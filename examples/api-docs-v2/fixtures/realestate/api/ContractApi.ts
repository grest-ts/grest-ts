import {GGRpc, httpSchema} from "@grest-ts/http";
import {FORBIDDEN, GGContractClass, IsArray, IsBit, IsEnum, IsLiteral, IsNumber, IsObject, IsString, IsTuple, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema";
import {IsCreatedAndChangedBy} from "./UserApi";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsApartmentFeatureId, IsApartmentId, IsBuildingId, IsClientId, IsContractExtraId, IsContractId, IsDate, IsDateTime} from "../Brands";
import {IsApartmentFeatureType} from "./ApartmentFeaturesApi";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";
// ---------------------------------------------------------
// Re-exports
// ---------------------------------------------------------


// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum ContractState {
    active = "active",
    endedButIssues = "endedButIssues",
    ended = "ended",
    all = "all"
}

const IsContractState = IsEnum(ContractState)

export enum InvoiceDueType {
    dueDays = "dueDays",
    dueDate = "dueDate"
}

export const IsInvoiceDueType = IsEnum(InvoiceDueType)

export enum ContractSettingsFilter {
    rendin = "rendin",
    casapay = "casapay",
    noHandler = "noHandler",
    manualDebtHandling = "manualDebtHandling",
    sendUtilitiesInvoices = "sendUtilitiesInvoices",
    hasCars = "hasCars"
}

export const IsContractSettingsFilter = IsEnum(ContractSettingsFilter)

export enum ContractSkipExpensesType {
    electricity_network = 'electricity_network',
    electricity = 'electricity',
    utilities = 'utilities',
    utilities_opt = 'utilities_opt',
    insurance = 'insurance'
}

export const IsContractSkipExpensesType = IsEnum(ContractSkipExpensesType)

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsContractApiGetForSelectRequest = IsObject({
    ids: IsArray(IsContractId).orNull.orUndefined,
    clientId: IsClientId.orNull.orUndefined,
    apartmentIds: IsArray(IsApartmentId).orNull.orUndefined
}).orUndefined.default({})
export type ContractApiGetForSelectRequest = typeof IsContractApiGetForSelectRequest.infer

export const IsContractRow = IsObject({
    id: IsContractId,
    name: IsString,
    apartmentId: IsApartmentId,
})
export type ContractRow = typeof IsContractRow.infer

export const IsContractApiGetForSelectResponse = IsObject({
    rows: IsArray(IsContractRow)
})
export type ContractApiGetForSelectResponse = typeof IsContractApiGetForSelectResponse.infer

export const IsGetContractEmailsQuery = IsObject({
    buildingId: IsBuildingId
})
export type GetContractEmailsQuery = typeof IsGetContractEmailsQuery.infer

export const IsGetContractEmailsResponseRow = IsObject({
    clientName: IsString,
    clientEmail: IsString,
    tenantName: IsString,
    tenantEmail: IsString
})
export type GetContractEmailsResponseRow = typeof IsGetContractEmailsResponseRow.infer

export const IsGetContractEmailsResponse = IsObject({
    rows: IsArray(IsGetContractEmailsResponseRow)
})
export type GetContractEmailsResponse = typeof IsGetContractEmailsResponse.infer

export const IsContractsQuery = IsObject({
    id: IsContractId.orNull.orUndefined,
    buildingId: IsBuildingId.orNull.orUndefined,
    apartmentId: IsApartmentId.orNull.orUndefined,
    clientId: IsClientId.orNull.orUndefined,
    search: IsString.orNull.orUndefined,
    settingsFilter: IsContractSettingsFilter.orNull.orUndefined,
    state: IsContractState,
    orderBy: IsObject({
        field: IsLiteral("balance", "start", "end", "apartment", "clientName", "rentSum", "depositSum", "transferContractDate"),
        dir: IsLiteral("asc", "desc").orUndefined
    }).orNull.orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orNull.orUndefined
})
export type ContractsQuery = typeof IsContractsQuery.infer

export const IsContractsResultRowExtra = IsObject({
    type: IsApartmentFeatureType,
    name: IsString
})

export const IsContractsResultRow = IsObject({
    id: IsContractId,
    referenceNo: IsString,
    start: IsString,
    end: IsString,
    apartmentId: IsApartmentId,
    apartment: IsString,
    clientId: IsClientId,
    clientName: IsString,
    clientEmail: IsString.orNull,
    clientLanguage: IsString,
    tenantName: IsString.orNull,
    tenantLanguage: IsString.orNull,
    tenantEmail: IsString.orNull,
    rentSum: IsNumber,
    depositSum: IsNumber,
    rendinContractId: IsString.orNull,
    manualDebtHandling: IsLiteral(0, 1),
    sendUtilitiesInvoiceWithRentInvoices: IsLiteral(0, 1),
    transferContractDate: IsString.orNull,
    balance: IsNumber,
    futureInvoicesSumWithVat: IsNumber.orNull,
    extras: IsArray(IsContractsResultRowExtra)
})
export type ContractsResultRow = typeof IsContractsResultRow.infer

export const IsContractsResult = IsObject({
    rows: IsArray(IsContractsResultRow)
})
export type ContractsResult = typeof IsContractsResult.infer

export const IsContractsSummaryResult = IsObject({
    currentRentSum: IsNumber.orNull,
    debtSum: IsNumber.orNull,
    overpaidSum: IsNumber.orNull
})
export type ContractsSummaryResult = typeof IsContractsSummaryResult.infer

export const IsDeleteContractRequest = IsObject({
    id: IsContractId
})
export type DeleteContractRequest = typeof IsDeleteContractRequest.infer

export const IsGetContractRequest = IsObject({
    id: IsContractId
})
export type GetContractRequest = typeof IsGetContractRequest.infer

export const IsContractExtra = IsObject({
    id: IsContractExtraId.orNull.orUndefined,
    apartmentFeatureId: IsApartmentFeatureId,
    start: IsDate.orNull.orUndefined,
    end: IsDate.orNull.orUndefined,
    rentSum: IsNumber,
    hasCustomVat: IsBit,
    rentVat: IsNumber.orNull.orUndefined,
    rentSumWithVat: IsNumber.orNull.orUndefined
})
export type ContractExtra = typeof IsContractExtra.infer

export const IsSyncContractData = IsObject({
    id: IsContractId.orNull.orUndefined,
    apartmentId: IsApartmentId,
    apartmentAddress: IsString.orUndefined,
    clientId: IsClientId,
    clientName: IsString.orUndefined,
    tenantId: IsClientId,
    start: IsDate,
    end: IsDate,
    rentSum: IsNumber,
    openingBalanceDate: IsDate.orNull.orUndefined,
    openingBalance: IsNumber.default(0),
    openingDepositBalance: IsNumber.default(0),
    balance: IsNumber.default(0),
    tenantCar: IsString.orNull,
    depositSum: IsNumber,
    transferContractDate: IsDate.orNull.orUndefined,
    isDepositReturned: IsLiteral(0, 1).default(0),
    invoiceDueType: IsInvoiceDueType,
    invoiceDueDays: IsNumber,
    referenceNo: IsString.orNull.orUndefined,
    comment: IsString.orNull,
    noOfKeys: IsNumber.orNull,
    rendinContractId: IsString.orNull,
    casaPayClientEmail: IsString.orNull,
    manualDebtHandling: IsLiteral(0, 1).default(0),
    sendUtilitiesInvoiceWithRentInvoices: IsLiteral(0, 1).default(0),
    welcomeEmailSent: IsDateTime.orNull.orUndefined,
    skipExpenses: IsArray(IsContractSkipExpensesType).default([]),
    rentHistory: IsArray(IsObject({fromDate: IsString, sum: IsNumber})).default([]),
    extras: IsArray(IsContractExtra).default([])
}).merge(IsCreatedAndChangedBy)
export type SyncContractData = typeof IsSyncContractData.infer

export const IsSyncContractDataResponse = IsObject({
    id: IsContractId
})
export type SyncContractDataResponse = typeof IsSyncContractDataResponse.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const ContractApiContract = new GGContractClass("ContractApi", {
    getForSelect: {
        input: IsContractApiGetForSelectRequest,
        success: IsContractApiGetForSelectResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    getSummary: {
        input: IsObject({}).orUndefined.default({}),
        success: IsContractsSummaryResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    list: {
        input: IsContractsQuery,
        success: IsContractsResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    get: {
        input: IsGetContractRequest,
        success: IsSyncContractData,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    sync: {
        input: IsSyncContractData,
        success: IsSyncContractDataResponse,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    delete: {
        input: IsDeleteContractRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    getContractEmails: {
        input: IsGetContractEmailsQuery,
        success: IsGetContractEmailsResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const ContractApi = httpSchema(ContractApiContract)
    .pathPrefix("gg/contract")
    .use(GG_USER_AUTH)
    .use(GG_COMPANY_AUTH_TOKEN)
    .routes({
        getForSelect: GGRpc.POST("getForSelect"),
        getSummary: GGRpc.POST("getSummary"),
        list: GGRpc.POST("list"),
        get: GGRpc.POST("get"),
        sync: GGRpc.POST("sync"),
        delete: GGRpc.POST("delete"),
        getContractEmails: GGRpc.POST("getContractEmails")
    })

