import {GGRpc, httpSchema} from "@grest-ts/http";
import {GGFileDownload} from "@grest-ts/http-file";
import {FORBIDDEN, GGContractClass, IsArray, IsBit, IsBoolean, IsEnum, IsLiteral, IsNumber, IsObject, IsString, IsTuple, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";
import {IsFile} from "@grest-ts/schema-file";
import {FORBIDDEN_BOOKKEEPING_LOCKED} from "../ApiError";
import {IsBuildingId, tInvoiceNo} from "../Brands";
import {IsCountry2, IsLanguage, regCodeError, vatCodeError} from "../Brands";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {isValidVatCode} from "../common/isValidVatCode";
import {
    IsApartmentFeatureId,
    IsApartmentId,
    IsBookkeepingIntegrationId,
    IsClientId,
    IsContractExtraId,
    IsContractId,
    IsDate,
    IsExpenseCompensationId,
    IsExpenseId,
    IsExpenseRowId,
    IsInsuranceId,
    IsInvoiceFutureRowId,
    IsInvoiceId,
    IsInvoiceRowId,
    IsPIDataId,
    IsYearMonth
} from "../Brands";
import {IsOwnerId} from "./OwnerApi";
import {IsCompanyId} from "./CompanyApi";
import {IsContractSkipExpensesType, IsInvoiceDueType} from "./ContractApi";
import {IsExpenseType} from "./ExpenseApi";
import {IsClientType} from "./ClientApi";
import {IsApartmentExpectedExpense, IsApartmentInvoicingScheme} from "./ApartmentApi";
import {IsApartmentFeatureType} from "./ApartmentFeaturesApi";
import {IsInvoiceFutureRowType} from "./InvoiceFutureRowApi";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";
import {isValidCompanyCode} from "../common/isValidCompanyCode";
export type {tInvoiceNo}

// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum InvoiceRowType {
    rent = "rent",
    parking = "parking",
    storage = "storage",
    bicycleSpot = "bicycleSpot",
    expense = "expense",
    custom = "custom",
    deposit = "deposit",
    sales = "sales",
    compensation = "compensation"
}

const IsInvoiceRowType = IsEnum(InvoiceRowType)

export enum DownloadEInvoicesRequestUseDate {
    date = "date",
    entryDate = "entryDate"
}

const IsDownloadEInvoicesRequestUseDate = IsEnum(DownloadEInvoicesRequestUseDate)

// ---------------------------------------------------------
// Type Schemas - Requests
// ---------------------------------------------------------

export const IsInvoicesQuery = IsObject({
    id: IsInvoiceId.orNull.orUndefined,
    apartmentId: IsApartmentId.orNull.orUndefined,
    toClientId: IsClientId.orNull.orUndefined,
    start: IsDate.orNull.orUndefined,
    end: IsDate.orNull.orUndefined,
    entryMonth: IsYearMonth.orNull.orUndefined,
    isSyncedToBookkeeping: IsLiteral("0", "1").orNull.orUndefined,
    orderBy: IsObject({
        field: IsLiteral("invoiceNo", "apartment", "entryDate", "date", "clientName", "sum", "sumWithVat"),
        dir: IsLiteral("asc", "desc").orUndefined
    }).orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orUndefined
}).orUndefined
export type InvoicesQuery = typeof IsInvoicesQuery.infer

export const IsGetInvoiceRequest = IsObject({
    id: IsInvoiceId
})
export type GetInvoiceRequest = typeof IsGetInvoiceRequest.infer

export const IsDeleteInvoiceRequest = IsObject({
    id: IsInvoiceId
})
export type DeleteInvoiceRequest = typeof IsDeleteInvoiceRequest.infer

export const IsCreateInvoiceData = IsObject({
    contractId: IsContractId,
    date: IsDate
})
export type CreateInvoiceData = typeof IsCreateInvoiceData.infer

export const IsCreateInvoiceResult = IsObject({
    id: IsInvoiceId
})
export type CreateInvoiceResult = typeof IsCreateInvoiceResult.infer

export const IsCreateCreditInvoiceData = IsObject({
    creditToInvoiceId: IsInvoiceId
})
export type CreateCreditInvoiceData = typeof IsCreateCreditInvoiceData.infer

export const IsDownloadInvoicePdfRequest = IsObject({
    invoiceId: IsInvoiceId
})
export type DownloadInvoicePdfRequest = typeof IsDownloadInvoicePdfRequest.infer

export const IsDownloadEInvoiceRequest = IsObject({
    invoiceId: IsInvoiceId
})
export type DownloadEInvoiceRequest = typeof IsDownloadEInvoiceRequest.infer

export const IsDownloadEInvoicesRequest = IsObject({
    useDate: IsDownloadEInvoicesRequestUseDate,
    start: IsDate,
    end: IsDate
})
export type DownloadEInvoicesRequest = typeof IsDownloadEInvoicesRequest.infer

// ---------------------------------------------------------
// Type Schemas - InvoiceRow
// ---------------------------------------------------------

export const IsInvoiceRow = IsObject({
    id: IsInvoiceRowId.orUndefined,
    type: IsInvoiceRowType,
    expenseType: IsExpenseType.orNull.orUndefined,
    start: IsDate.orNull.orUndefined,
    end: IsDate.orNull.orUndefined,
    title: IsString,
    sum: IsNumber,
    sumWithVat: IsNumber,
    vat: IsNumber.orNull,
    articleCode: IsString.orNull.orUndefined,
    contractId: IsContractId,
    expenseId: IsExpenseId.orNull.orUndefined,
    invoiceFutureRowId: IsInvoiceFutureRowId.orNull.orUndefined
})
export type InvoiceRow = typeof IsInvoiceRow.infer

// ---------------------------------------------------------
// Type Schemas - BookkeepingIntegration, CreditInvoice
// ---------------------------------------------------------

export const IsBookkeepingIntegrationInfo = IsObject({
    id: IsBookkeepingIntegrationId,
    name: IsString,
    isSynced: IsLiteral(0, 1)
})
export type BookkeepingIntegrationInfo = typeof IsBookkeepingIntegrationInfo.infer

export const IsInvoiceCreditInvoiceData = IsObject({
    id: IsInvoiceId,
    invoiceNo: IsString,
    sumWithVat: IsNumber
})
export type InvoiceCreditInvoiceData = typeof IsInvoiceCreditInvoiceData.infer

// ---------------------------------------------------------
// Type Schemas - Responses
// ---------------------------------------------------------

export const IsInvoicesResultRow = IsObject({
    id: IsInvoiceId,
    creditToInvoiceId: IsInvoiceId.orNull,
    invoiceNo: IsString,
    contractId: IsContractId,
    date: IsDate,
    entryDate: IsDate,
    apartment: IsString,
    apartmentId: IsApartmentId,
    clientName: IsString,
    clientId: IsClientId,
    tenantEmail: IsString.orNull,
    sum: IsNumber,
    sumWithVat: IsNumber,
    isSent: IsLiteral(0, 1),
    clientBalanceSum: IsNumber,
    contractBalanceSum: IsNumber,
    fromOwnerId: IsOwnerId.orNull.orUndefined,
    fromName: IsString,
    isSyncedToBookkeeping: IsLiteral(0, 1).orNull.orUndefined,
    createdByUser: IsString.orUndefined,
    changedByUser: IsString.orUndefined
})
export type InvoicesResultRow = typeof IsInvoicesResultRow.infer

export const IsInvoicesResult = IsObject({
    query: IsInvoicesQuery,
    rows: IsArray(IsInvoicesResultRow)
})
export type InvoicesResult = typeof IsInvoicesResult.infer

// ---------------------------------------------------------
// Type Schemas - SyncInvoiceData
// ---------------------------------------------------------

export const IsSyncInvoiceData = IsObject({
    id: IsInvoiceId,
    created: IsString.orUndefined,
    changed: IsString.orUndefined,
    toClientId: IsClientId,
    toClientName: IsString.orUndefined,
    contractId: IsContractId,
    contractBalanceSum: IsNumber,
    contractStart: IsString.orUndefined,
    contractEnd: IsString.orUndefined,
    contractBalance: IsNumber,
    apartmentId: IsApartmentId.orUndefined,
    apartment: IsString.orUndefined,
    creditToInvoiceId: IsInvoiceId.orNull.orUndefined,
    creditToInvoice: IsInvoiceCreditInvoiceData.orNull.orUndefined,
    invoiceNo: IsString.orUndefined,
    date: IsDate,
    entryDate: IsDate,
    serviceProvidedDate: IsDate,
    paymentDate: IsDate.orNull,
    forcedEntryDate: IsDate.orNull,
    automaticInvoiceMonth: IsDate.orNull.orUndefined,
    dueType: IsInvoiceDueType,
    dueDays: IsNumber,
    dueDate: IsDate,
    isSent: IsLiteral(0, 1),
    sum: IsNumber,
    sumWithVat: IsNumber,
    language: IsLanguage,
    toName: IsString,
    toCountry: IsCountry2,
    toCode: IsString.trim.orNull,
    toVatNo: IsString.trim.orNull.orUndefined,
    toEmail: IsString.orNull.orUndefined,
    toAddress: IsString.orNull,
    fromOwnerId: IsOwnerId.orNull.orUndefined,
    fromName: IsString,
    fromAddress: IsString,
    fromCountry: IsCountry2,
    fromRegNo: IsString.trim.orNull,
    fromVatNo: IsString.trim.orNull.orUndefined,
    fromAccount1: IsString,
    rows: IsArray(IsInvoiceRow),
    creditInvoices: IsArray(IsInvoiceCreditInvoiceData),
    bookkeepingIntegrations: IsArray(IsBookkeepingIntegrationInfo),
    isBookkeepingLocked: IsBoolean.orUndefined,
    createdByUser: IsString.orUndefined,
    changedByUser: IsString.orUndefined
})
    .refine(obj => !obj.fromRegNo || isValidCompanyCode(obj.fromRegNo, obj.fromCountry), regCodeError)
    .refine(obj => isValidVatCode(obj.fromVatNo, obj.fromCountry), vatCodeError)
export type SyncInvoiceData = typeof IsSyncInvoiceData.infer

// ---------------------------------------------------------
// Type Schemas - PrepareInvoices (PI* types)
// ---------------------------------------------------------

export const IsPIApartment = IsObject({
    id: IsApartmentId,
    address: IsString
})
export type PIApartment = typeof IsPIApartment.infer

export const IsPIClient = IsObject({
    id: IsClientId,
    name: IsString,
    email: IsString.orNull,
    country: IsCountry2,
    code: IsString.orNull,
    vatNo: IsString.orNull,
    address: IsString.orNull,
    language: IsLanguage,
    type: IsClientType
})
export type PIClient = typeof IsPIClient.infer

export const IsPIOwner = IsObject({
    id: IsOwnerId,
    name: IsString,
    email: IsString.orNull,
    country: IsCountry2,
    code: IsString.orNull.orUndefined,
    vatNo: IsString.orNull,
    address: IsString.orNull,
    invoiceAccount1: IsString.orNull
})
export type PIOwner = typeof IsPIOwner.infer

export const IsPrepareInvoiceInvoiceDataRowPeriodInfo = IsObject({
    start: IsDate,
    end: IsDate,
    maxDays: IsNumber,
    days: IsNumber
})
export type PrepareInvoiceInvoiceDataRowPeriodInfo = typeof IsPrepareInvoiceInvoiceDataRowPeriodInfo.infer

export const IsPrepareInvoiceInvoiceDataRow = IsObject({
    type: IsInvoiceRowType,
    period: IsPrepareInvoiceInvoiceDataRowPeriodInfo.orNull.orUndefined,
    start: IsDate,
    end: IsDate,
    title: IsString,
    sum: IsNumber,
    vat: IsNumber.orNull,
    sumWithVat: IsNumber,
    articleCode: IsString.orNull.orUndefined,
    invoiceFutureRowId: IsInvoiceFutureRowId.orUndefined,
    expenseRowId: IsExpenseRowId.orUndefined,
    expenseType: IsExpenseType.orUndefined,
    expenseId: IsExpenseId.orUndefined,
    contractExtraId: IsContractExtraId.orUndefined,
    contractExtraContractId: IsContractId.orUndefined
})
export type PrepareInvoiceInvoiceDataRow = typeof IsPrepareInvoiceInvoiceDataRow.infer

export const IsPrepareInvoiceInvoiceData = IsObject({
    clientId: IsClientId,
    contractId: IsContractId,
    date: IsDate,
    entryDate: IsDate,
    serviceProvidedDate: IsDate,
    automaticInvoiceMonth: IsDate,
    dueType: IsInvoiceDueType,
    dueDays: IsNumber,
    sum: IsNumber,
    sumWithVat: IsNumber,
    toEmail: IsString.orNull,
    toName: IsString,
    toCountry: IsString,
    toCode: IsString.orNull,
    toVatNo: IsString.orNull,
    toAddress: IsString,
    language: IsString,
    fromOwnerId: IsOwnerId.orUndefined,
    fromName: IsString,
    fromAddress: IsString,
    fromCountry: IsString,
    fromRegNo: IsString,
    fromVatNo: IsString.orNull,
    fromAccount1: IsString,
    rows: IsArray(IsPrepareInvoiceInvoiceDataRow)
})
export type PrepareInvoiceInvoiceData = typeof IsPrepareInvoiceInvoiceData.infer

export const IsPIContract = IsObject({
    id: IsContractId,
    companyId: IsCompanyId,
    apartmentId: IsApartmentId,
    buildingId: IsBuildingId,
    apartmentAddress: IsString.orNull.orUndefined,
    apartmentBookingReference: IsString.orNull.orUndefined,
    existingInvoiceId: IsInvoiceId.orNull.orUndefined,
    existingInvoiceSumWithVat: IsNumber.orNull.orUndefined,
    clientId: IsClientId,
    casapayClientEmail: IsString.orNull,
    isBusinessPlaceRent: IsLiteral(1, 0),
    apartmentInvoicingScheme: IsApartmentInvoicingScheme,
    apartmentOwnerId: IsOwnerId.orNull,
    start: IsString,
    end: IsString,
    rentSum: IsNumber,
    depositSum: IsNumber,
    invoiceDueType: IsInvoiceDueType,
    invoiceDueDays: IsNumber,
    vat: IsNumber.orNull,
    balance: IsNumber,
    expectedExpenses: IsArray(IsApartmentExpectedExpense),
    skipExpenses: IsArray(IsContractSkipExpensesType)
})
export type PIContract = typeof IsPIContract.infer

export const IsPIContractExtra = IsObject({
    id: IsContractExtraId,
    contractId: IsContractId,
    apartmentId: IsApartmentId,
    apartmentFeatureId: IsApartmentFeatureId,
    start: IsDate,
    end: IsDate,
    rentSum: IsNumber,
    hasCustomVat: IsBit,
    rentVat: IsNumber.orNull,
    rentSumWithVat: IsNumber,
    name: IsString,
    buildingAddress: IsString,
    type: IsApartmentFeatureType
})
export type PIContractExtra = typeof IsPIContractExtra.infer

export const IsPIUtilityExpense = IsObject({
    id: IsExpenseRowId,
    expenseId: IsExpenseId,
    apartmentId: IsApartmentId,
    expenseType: IsExpenseType,
    date: IsString,
    sum: IsNumber,
    sumWithVat: IsNumber,
    vat: IsNumber.orNull,
    articleCode: IsString.orNull,
    titleToInvoice: IsString.orNull.orUndefined
})
export type PIUtilityExpense = typeof IsPIUtilityExpense.infer

export const IsPIInsurance = IsObject({
    id: IsInsuranceId,
    apartmentId: IsApartmentId,
    expenseRowId: IsExpenseRowId,
    expenseId: IsExpenseId,
    expenseType: IsExpenseType,
    periodStart: IsDate,
    periodEnd: IsDate,
    sum: IsNumber,
    sumWithVat: IsNumber,
    vat: IsNumber.orNull,
    articleCode: IsString.orNull
})
export type PIInsurance = typeof IsPIInsurance.infer

export const IsPIExpenseCompensation = IsObject({
    id: IsExpenseCompensationId,
    expenseId: IsExpenseId,
    expenseRowId: IsExpenseRowId,
    contractId: IsContractId,
    apartmentId: IsApartmentId,
    paidByClientId: IsClientId,
    apartmentOwnerId: IsOwnerId.orNull,
    expenseType: IsExpenseType,
    date: IsDate,
    sum: IsNumber,
    sumWithVat: IsNumber,
    vat: IsNumber.orNull,
    articleCode: IsString.orNull,
    apartmentVat: IsNumber.orNull,
    titleToInvoice: IsString.orNull
})
export type PIExpenseCompensation = typeof IsPIExpenseCompensation.infer

export const IsPIInvoiceFutureRow = IsObject({
    id: IsInvoiceFutureRowId,
    contractId: IsContractId,
    date: IsDate,
    type: IsInvoiceFutureRowType,
    title: IsString,
    sum: IsNumber,
    vat: IsNumber.orNull,
    sumWithVat: IsNumber,
    articleCode: IsString.orNull
})
export type PIInvoiceFutureRow = typeof IsPIInvoiceFutureRow.infer

export const IsPIData = IsObject({
    id: IsPIDataId,
    toClientId: IsClientId,
    apartmentId: IsApartmentId,
    client: IsPIClient,
    owner: IsPIOwner.orUndefined,
    apartment: IsPIApartment,
    contract: IsObject({
        sourceData: IsPIContract,
        rentInvoiceRow: IsPrepareInvoiceInvoiceDataRow.orUndefined,
        depositInvoiceRow: IsPrepareInvoiceInvoiceDataRow.orUndefined,
        extras: IsObject({
            sourceRows: IsArray(IsPIContractExtra),
            invoiceRows: IsArray(IsPrepareInvoiceInvoiceDataRow)
        }),
        utilities: IsObject({
            queryRange: IsTuple(IsString, IsString),
            period: IsPrepareInvoiceInvoiceDataRowPeriodInfo.orNull.orUndefined,
            sourceRows: IsArray(IsPIUtilityExpense),
            invoiceRows: IsArray(IsPrepareInvoiceInvoiceDataRow)
        }),
        insurance: IsObject({
            sourceRows: IsArray(IsPIInsurance),
            invoiceRows: IsArray(IsPrepareInvoiceInvoiceDataRow)
        })
    }).orUndefined,
    expenses: IsObject({
        queryRange: IsTuple(IsString, IsString),
        sourceRows: IsArray(IsPIExpenseCompensation),
        invoiceRows: IsArray(IsPrepareInvoiceInvoiceDataRow)
    }),
    futureRows: IsObject({
        queryRange: IsTuple(IsString, IsString),
        sourceRows: IsArray(IsPIInvoiceFutureRow),
        invoiceRows: IsArray(IsPrepareInvoiceInvoiceDataRow)
    }),
    invoice: IsPrepareInvoiceInvoiceData,
    analyzes: IsObject({
        neededExpenses: IsArray(IsApartmentExpectedExpense),
        missingExpenses: IsArray(IsApartmentExpectedExpense),
        expensesOk: IsBoolean,
        noExistingInvoice: IsBoolean,
        ok: IsBoolean
    })
})
export type PIData = typeof IsPIData.infer

// ---------------------------------------------------------
// Type Schemas - PrepareCreate / FinalizeCreate
// ---------------------------------------------------------

export const IsPrepareInvoicesQuery = IsObject({
    year: IsNumber,
    month: IsNumber,
    apartmentIds: IsArray(IsApartmentId).orUndefined,
    buildingIds: IsArray(IsBuildingId).orUndefined,
    ownerIds: IsArray(IsOwnerId).orUndefined
})
export type PrepareInvoicesQuery = typeof IsPrepareInvoicesQuery.infer

export const IsPrepareInvoicesResult = IsObject({
    dates: IsObject({
        prev: IsTuple(IsString, IsString),
        this: IsTuple(IsString, IsString),
        next: IsTuple(IsString, IsString)
    }),
    rows: IsArray(IsPIData),
    summary: IsObject({
        noOfInvoicesWithRentRow: IsNumber,
        noOfInvoicesWithExpenseRows: IsNumber,
        noOfInvoices: IsNumber,
        noOfApartments: IsNumber,
        noOfApartmentsWithRent: IsNumber,
        rentSumWithVat: IsNumber,
        utilitiesSumWithVat: IsNumber,
        expensesSumWithVat: IsNumber,
        totalSumWithVat: IsNumber
    })
})
export type PrepareInvoicesResult = typeof IsPrepareInvoicesResult.infer

export const IsCreateInvoicesQuery = IsObject({
    year: IsNumber,
    month: IsNumber,
    apartmentIds: IsArray(IsApartmentId).orUndefined,
    buildingIds: IsArray(IsBuildingId).orUndefined,
    ownerIds: IsArray(IsOwnerId).orUndefined,
    ids: IsArray(IsPIDataId)
})
export type CreateInvoicesQuery = typeof IsCreateInvoicesQuery.infer

export const IsCreateInvoicesResultRow = IsObject({
    id: IsInvoiceId.orUndefined,
    success: IsBoolean,
    data: IsPIData,
    error: IsString.orUndefined
})
export type CreateInvoicesResultRow = typeof IsCreateInvoicesResultRow.infer

export const IsCreateInvoicesResult = IsObject({
    summary: IsObject({
        noOfInvoicesCreated: IsNumber,
        noOfInvoicesFailed: IsNumber
    }),
    rows: IsArray(IsCreateInvoicesResultRow)
})
export type CreateInvoicesResult = typeof IsCreateInvoicesResult.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const InvoicesApiContract = new GGContractClass("InvoicesApi", {
    list: {
        input: IsInvoicesQuery,
        success: IsInvoicesResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    get: {
        input: IsGetInvoiceRequest,
        success: IsSyncInvoiceData,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    delete: {
        input: IsDeleteInvoiceRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, FORBIDDEN_BOOKKEEPING_LOCKED, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    create: {
        input: IsCreateInvoiceData,
        success: IsCreateInvoiceResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, FORBIDDEN_BOOKKEEPING_LOCKED, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    createCredit: {
        input: IsCreateCreditInvoiceData,
        success: IsCreateInvoiceResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    sync: {
        input: IsSyncInvoiceData,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, FORBIDDEN, FORBIDDEN_BOOKKEEPING_LOCKED, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    downloadPdf: {
        input: IsDownloadInvoicePdfRequest,
        success: IsFile,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    downloadHtml: {
        input: IsDownloadInvoicePdfRequest,
        success: IsFile,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    downloadEInvoice: {
        input: IsDownloadEInvoiceRequest,
        success: IsFile,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    downloadEInvoices: {
        input: IsDownloadEInvoicesRequest,
        success: IsFile,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    prepareCreate: {
        input: IsPrepareInvoicesQuery,
        success: IsPrepareInvoicesResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    finalizeCreate: {
        input: IsCreateInvoicesQuery,
        success: IsCreateInvoicesResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, FORBIDDEN_BOOKKEEPING_LOCKED, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const InvoicesApi = httpSchema(InvoicesApiContract)
    .pathPrefix("gg/invoice")
    .use(GG_USER_AUTH)
    .use(GG_COMPANY_AUTH_TOKEN)
    .routes({
        list: GGRpc.POST("list"),
        get: GGRpc.POST("get"),
        delete: GGRpc.POST("delete"),
        create: GGRpc.POST("create"),
        createCredit: GGRpc.POST("createCredit"),
        sync: GGRpc.POST("sync"),
        downloadPdf: GGFileDownload.GET("downloadPdf"),
        downloadHtml: GGFileDownload.GET("downloadHtml"),
        downloadEInvoice: GGFileDownload.GET("downloadEInvoice"),
        downloadEInvoices: GGFileDownload.GET("downloadEInvoices"),
        prepareCreate: GGRpc.POST("prepareCreate"),
        finalizeCreate: GGRpc.POST("finalizeCreate")
    })

