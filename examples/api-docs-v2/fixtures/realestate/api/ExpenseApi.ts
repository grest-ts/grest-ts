import {GGRpc, GGHttpSchema} from "@grest-ts/http";
import {IsArray, IsBoolean, IsObject, IsString, IsNumber, IsEnum, IsLiteral, IsTuple, GGContractClass, FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/schema";
import {FORBIDDEN_BOOKKEEPING_LOCKED} from "../ApiError";
import {IsCreatedAndChangedBy} from "./UserApi";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsApartmentId, IsBookkeepingIntegrationId, IsClientId, IsContractId, IsCountry2, IsDate, IsExpenseCompensationId, IsExpenseFileId, IsExpenseId, IsExpenseRowId, IsInsuranceId, IsInvoiceId, IsInvoiceRowId, IsPaymentId, IsYearMonth, regCodeError, vatCodeError} from "../Brands";
import {isValidVatCode} from "../common/isValidVatCode";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";
import {isValidCompanyCode} from "../common/isValidCompanyCode";


// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum ExpenseType {
    electricity_network = 'electricity_network',
    electricity = 'electricity',
    utilities = 'utilities',
    utilities_opt = 'utilities_opt',
    insurance = 'insurance',
    contractFee = "contractFee",
    other = 'other',
    notary = 'notary',
    maintenance = 'maintenance'
}

export enum ExpenseRowBookkeepingCalculationType {
    noVat = "noVat",
    noVat_ClientIsNotBusiness = "noVat_ClientIsNotBusiness",
    noVat_ApartmentIsNotVatLiable = "noVat_ApartmentIsNotVatLiable",
    vat_ApartmentAlwaysHasVat = "vat_ApartmentAlwaysHasVat",
    vat_CompensatedExpense = "vat_CompensatedExpense",
    noVat_CompensatedExpenseButBusinessNotVatLiable = "noVat_CompensatedExpenseButBusinessNotVatLiable",
    vat_NoContractApartmentHasVat = "vat_NoContractApartmentHasVat",
    vat_ContractVatLiable = "vat_ContractVatLiable",
    noVat_ContractNotVatLiable = "noVat_ContractNotVatLiable",
    mixedVat_MultipleContracts = "mixedVat_MultipleContracts",
}

export const IsExpenseType = IsEnum(ExpenseType)
const IsExpenseRowBookkeepingCalculationType = IsEnum(ExpenseRowBookkeepingCalculationType)

// ---------------------------------------------------------
// Utility functions
// ---------------------------------------------------------

export function getUtilityTypes(): ExpenseType[] {
    return [ExpenseType.utilities, ExpenseType.utilities_opt, ExpenseType.electricity, ExpenseType.electricity_network];
}

export function isUtility(type: ExpenseType): boolean {
    return type === ExpenseType.utilities
        || type === ExpenseType.utilities_opt
        || type === ExpenseType.electricity
        || type === ExpenseType.electricity_network
}

// ---------------------------------------------------------
// Type Schemas - Requests
// ---------------------------------------------------------

export const IsExpensesQuery = IsObject({
    id: IsExpenseId.orNull.orUndefined,
    search: IsString.orNull.orUndefined,
    apartmentId: IsApartmentId.orNull.orUndefined,
    start: IsDate.orNull.orUndefined,
    end: IsDate.orNull.orUndefined,
    entryMonth: IsYearMonth.orNull.orUndefined,
    isSyncedToBookkeeping: IsLiteral("0", "1").orNull.orUndefined,
    type: IsExpenseType.orNull.orUndefined,
    orderBy: IsObject({
        field: IsLiteral("apartmentAddress", "title", "invoiceNo", "date", "type", "sum", "entryDate", "sumWithVat"),
        dir: IsLiteral("asc", "desc").orUndefined
    }),
    limit: IsTuple(IsNumber, IsNumber)
}).orUndefined
export type ExpensesQuery = typeof IsExpensesQuery.infer

export const IsGetExpenseInput = IsObject({
    id: IsExpenseId
})
export type GetExpenseInput = typeof IsGetExpenseInput.infer

export const IsGetByFileExpenseInput = IsObject({
    fileId: IsExpenseFileId
})
export type GetByFileExpenseInput = typeof IsGetByFileExpenseInput.infer

export const IsGetExpenseRowInput = IsObject({
    id: IsExpenseRowId
})
export type GetExpenseRowInput = typeof IsGetExpenseRowInput.infer

export const IsDeleteExpenseRequest = IsObject({
    id: IsExpenseId
})
export type DeleteExpenseRequest = typeof IsDeleteExpenseRequest.infer

// ---------------------------------------------------------
// Type Schemas - Responses
// ---------------------------------------------------------

export const IsExpensesResultRow = IsObject({
    id: IsExpenseId,
    rowId: IsExpenseRowId,
    date: IsDate,
    dueDate: IsDate.orNull,
    entryDate: IsDate.orNull,
    fromName: IsString.orNull,
    fromRegCode: IsString.orNull,
    fromVatNo: IsString.orNull,
    comment: IsString.orNull,
    title: IsString,
    type: IsExpenseType,
    tenantCompensationSumWithVat: IsNumber.orNull,
    expenseCompensatedSumWithVat: IsNumber.orNull,
    apartmentId: IsApartmentId.orNull.orUndefined,
    apartmentAddress: IsString.orNull.orUndefined,
    sum: IsNumber,
    vat: IsNumber.orNull,
    sumWithVat: IsNumber,
    invoiceNo: IsString.orNull,
    isSyncedToBookkeeping: IsLiteral(1, 0).orNull,
    referenceNo: IsString.orUndefined.orNull,
    createdByUser: IsString.orUndefined,
    changedByUser: IsString.orUndefined
})
export type ExpensesResultRow = typeof IsExpensesResultRow.infer

export const IsExpensesResult = IsObject({
    query: IsExpensesQuery,
    rows: IsArray(IsExpensesResultRow)
})
export type ExpensesResult = typeof IsExpensesResult.infer

export const IsExpenseRowResult = IsObject({
    id: IsExpenseRowId,
    expenseId: IsExpenseId,
    apartmentId: IsApartmentId,
    apartmentAddress: IsString,
    sum: IsNumber,
    vat: IsNumber.orNull,
    sumWithVat: IsNumber,
    title: IsString,
    invoiceNo: IsString,
    date: IsDate,
    insurancePeriodStart: IsDate.orNull.orUndefined,
    insurancePeriodEnd: IsDate.orNull.orUndefined
})
export type ExpenseRowResult = typeof IsExpenseRowResult.infer

export const IsExpenseRowDataInvoice = IsObject({
    invoiceId: IsInvoiceId,
    id: IsInvoiceRowId,
    no: IsString,
    sumWithVat: IsNumber
})

export const IsSyncExpenseDataCompensationRow = IsObject({
    id: IsExpenseCompensationId,
    expenseRowId: IsExpenseRowId,
    sum: IsNumber,
    vat: IsNumber.orNull,
    sumWithVat: IsNumber,
    paidByClientId: IsClientId,
    paidByContractId: IsContractId,
    paidByContractAddress: IsString,
    paidByClientName: IsString,
    titleToInvoice: IsString,
    invoiceId: IsInvoiceId.orNull.orUndefined,
    invoiceNo: IsString.orNull.orUndefined
})

export const IsExpenseInsuranceRow = IsObject({
    id: IsInsuranceId,
    periodStart: IsDate,
    periodEnd: IsDate,
    sum: IsNumber,
    vat: IsNumber.orNull,
    sumWithVat: IsNumber
})

export const IsExpenseRowDataTenantCompensation = IsObject({
    id: IsPaymentId,
    date: IsString,
    title: IsString,
    sum: IsNumber,
    clientId: IsClientId,
    clientName: IsString
})

export const IsBookkeepingIntegration = IsObject({
    id: IsBookkeepingIntegrationId,
    name: IsString,
    isSynced: IsLiteral(0, 1)
})

export const IsSyncExpenseDataRow = IsObject({
    id: IsExpenseRowId.orNull.orUndefined,
    title: IsString,
    articleCode: IsString.orNull.orUndefined,
    type: IsExpenseType,
    sum: IsNumber,
    vat: IsNumber.orNull.orUndefined,
    vatSum: IsNumber,
    sumWithVat: IsNumber,
    apartmentId: IsApartmentId.orNull.orUndefined,
    apartmentAddress: IsString.orNull.orUndefined,
    compensation: IsSyncExpenseDataCompensationRow.orUndefined,
    insuranceRow: IsExpenseInsuranceRow.orUndefined,
    invoiceRows: IsArray(IsExpenseRowDataInvoice).orUndefined,
    bkVatExclSum: IsNumber.orUndefined,
    bkVatInclSum: IsNumber.orUndefined,
    bkVatInclVatSum: IsNumber.orUndefined,
    bkVatInclSumWithVat: IsNumber.orUndefined,
    bkCalculationType: IsExpenseRowBookkeepingCalculationType.orUndefined,
    bkCalculationData: IsString.orNull.orUndefined
})
export type SyncExpenseDataRow = typeof IsSyncExpenseDataRow.infer

export const IsSyncExpenseData = IsObject({
    id: IsExpenseId.orNull.orUndefined,
    date: IsDate,
    entryDate: IsDate.orNull.orUndefined,
    dueDate: IsDate,
    invoiceNo: IsString,
    referenceNo: IsString.orNull.orUndefined,
    fromRegCode: IsString.orNull.orUndefined,
    fromVatNo: IsString.orNull.orUndefined,
    fromName: IsString,
    fromCountry: IsCountry2.orNull.orUndefined,
    payToAccount: IsString.orNull.orUndefined,
    sum: IsNumber,
    vatSum: IsNumber,
    sumWithVat: IsNumber,
    rounding: IsNumber.orNull,
    comment: IsString.orNull.orUndefined,
    fileId: IsExpenseFileId.orNull,
    rows: IsArray(IsSyncExpenseDataRow).minLength(1),
    tenantCompensation: IsExpenseRowDataTenantCompensation.orNull.orUndefined,
    bookkeepingIntegrations: IsArray(IsBookkeepingIntegration).orUndefined,
    isBookkeepingLocked: IsBoolean.orUndefined
}).merge(IsCreatedAndChangedBy)
    .refine(obj => !obj.fromRegCode || isValidCompanyCode(obj.fromRegCode, obj.fromCountry), regCodeError)
    .refine(obj => isValidVatCode(obj.fromVatNo, obj.fromCountry), vatCodeError)
export type SyncExpenseData = typeof IsSyncExpenseData.infer

export const IsSyncExpenseResult = IsObject({
    id: IsExpenseId
})
export type SyncExpenseResult = typeof IsSyncExpenseResult.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const ExpenseApiContract = new GGContractClass("ExpenseApi", {
    list: {
        input: IsExpensesQuery,
        success: IsExpensesResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    get: {
        input: IsGetExpenseInput,
        success: IsSyncExpenseData,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    getByFile: {
        input: IsGetByFileExpenseInput,
        success: IsSyncExpenseData,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    getRow: {
        input: IsGetExpenseRowInput,
        success: IsExpenseRowResult,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    sync: {
        input: IsSyncExpenseData,
        success: IsSyncExpenseResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, FORBIDDEN_BOOKKEEPING_LOCKED, VALIDATION_ERROR, SERVER_ERROR],
    },
    delete: {
        input: IsDeleteExpenseRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, FORBIDDEN_BOOKKEEPING_LOCKED, VALIDATION_ERROR, SERVER_ERROR],
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const ExpenseApi = new GGHttpSchema({
    contract: ExpenseApiContract,
    pathPrefix: "gg/expense",
    use: [GG_USER_AUTH, GG_COMPANY_AUTH_TOKEN],
    routes: {
        list: GGRpc.POST("list"),
        get: GGRpc.POST("get"),
        getByFile: GGRpc.POST("getByFile"),
        getRow: GGRpc.POST("getRow"),
        sync: GGRpc.POST("sync"),
        delete: GGRpc.POST("delete")
    },
})

