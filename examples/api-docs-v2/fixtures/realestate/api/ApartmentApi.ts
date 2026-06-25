import {GGRpc, GGHttpSchema} from "@grest-ts/http";
import {FORBIDDEN, GGContractClass, IsArray, IsBit, IsBoolean, IsEnum, IsLiteral, IsNumber, IsObject, IsString, IsTuple, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/schema";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsOwnerId} from "./OwnerApi";
import {ApartmentFeatureType} from "./ApartmentFeaturesApi";
import {IsApartmentFeatureId, IsApartmentId, IsBuildingId, IsContractId, IsDate, IsExpenseId, IsExpenseRowId} from "../Brands";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";

// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum ApartmentState {
    ACTIVE = "active",
    HIDDEN = "hidden"
}

const IsApartmentState = IsEnum(ApartmentState)

export enum ApartmentExpectedExpense {
    electricity_network = 'electricity_network',
    electricity = 'electricity',
    utilities = 'utilities',
    insurance = 'insurance',
}

export const IsApartmentExpectedExpense = IsEnum(ApartmentExpectedExpense)

export enum ApartmentVatScheme {
    never = "never",
    always = "always",
    business = "business",
    businessWithVat = "businessWithVat"
}

const IsApartmentVatScheme = IsEnum(ApartmentVatScheme)

export enum ApartmentInvoicingScheme {
    manager = "manager",
    owner = "owner",
    none = "none"
}

export const IsApartmentInvoicingScheme = IsEnum(ApartmentInvoicingScheme)

const IsApartmentFeatureType = IsEnum(ApartmentFeatureType)

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsGetApartments2Query = IsObject({
    id: IsApartmentId.orNull.orUndefined,
    state: IsApartmentState.orNull.orUndefined,
    buildingId: IsBuildingId.orNull.orUndefined,
    ownerId: IsOwnerId.orNull.orUndefined,
    orderBy: IsObject({
        field: IsLiteral("lastContractEnds", "buildingAddress", "address", "size", "rooms", "floor", "currentRent", "ownerName", "insuranceExpires", "vacancy"),
        dir: IsLiteral("asc", "desc").orUndefined
    }).orNull.orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orNull.orUndefined
}).orUndefined
export type GetApartments2Query = typeof IsGetApartments2Query.infer

export const IsGetApartments2Row = IsObject({
    id: IsApartmentId,
    buildingId: IsBuildingId,
    buildingAddress: IsString,
    address: IsString,
    size: IsNumber.orNull,
    rooms: IsNumber.orNull,
    floor: IsNumber.orNull,
    soldDate: IsDate.orNull,
    insuranceExpires: IsDate.orNull,
    currentRent: IsNumber.orNull,
    currentContractId: IsContractId.orNull,
    vacancy: IsNumber.orNull,
    daysFromPurchase: IsNumber.orNull,
    emptyDaysAfterPurchase: IsNumber.orNull,
    daysRented: IsNumber.orNull,
    lastContractEnds: IsDate.orNull,
    invoicingScheme: IsApartmentInvoicingScheme,
    daysTillLastContractEnd: IsNumber.orNull,
    apartmentFeatureNames: IsString.orNull,
    state: IsApartmentState,
    ownerId: IsOwnerId.orNull,
    ownerName: IsString.orNull
})
export type GetApartments2Row = typeof IsGetApartments2Row.infer

export const IsGetApartments2Result = IsObject({
    rows: IsArray(IsGetApartments2Row)
})
export type GetApartments2Result = typeof IsGetApartments2Result.infer

export const IsGetApartmentsFinancialsQuery = IsObject({
    id: IsApartmentId.orNull.orUndefined,
    state: IsApartmentState.orNull.orUndefined,
    buildingId: IsBuildingId.orNull.orUndefined,
    ownerId: IsOwnerId.orNull.orUndefined,
    orderBy: IsObject({
        field: IsLiteral("buildingAddress", "address", "size", "rooms", "floor", "currentRent", "purchaseDate", "purchasePrice", "currentPrice"),
        dir: IsLiteral("asc", "desc").orUndefined
    }).orNull.orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orNull.orUndefined,
    referenceDate: IsDate.orNull.orUndefined,
}).orUndefined
export type GetApartmentsFinancialsQuery = typeof IsGetApartmentsFinancialsQuery.infer

export const IsFinancialsSummary = IsObject({
    purchasePrice: IsNumber.orNull.orUndefined,
    currentPrice: IsNumber.orNull.orUndefined,
    currentRent: IsNumber.orNull.orUndefined,
    expensesSum: IsNumber,
    incomeSum: IsNumber,
    profitSum: IsNumber,
    annualAvgProfitYield: IsNumber.orNull.orUndefined,
    annualCurrentRentYield: IsNumber.orNull.orUndefined,
    vacancy: IsNumber.orNull.orUndefined,
    priceIncrease: IsNumber.orNull.orUndefined,
    annualAvgPriceIncrease: IsNumber.orNull.orUndefined,
    annualYield: IsNumber.orNull.orUndefined
})
export type FinancialsSummary = typeof IsFinancialsSummary.infer

export const IsGetApartmentsResultApartmentFinancialsRow = IsObject({
    apartmentId: IsApartmentId,
    year: IsNumber,
    expensesSum: IsNumber,
    invoicesSum: IsNumber,
    profitSum: IsNumber,
    daysRented: IsNumber,
    daysRentable: IsNumber,
    vacancy: IsNumber.orNull
})
export type GetApartmentsResultApartmentFinancialsRow = typeof IsGetApartmentsResultApartmentFinancialsRow.infer

export const IsGetApartmentsResultApartmentFinancials = IsObject({
    id: IsApartmentId,
    buildingId: IsBuildingId,
    buildingAddress: IsString,
    address: IsString,
    size: IsNumber.orNull,
    rooms: IsNumber.orNull,
    floor: IsNumber.orNull,
    state: IsApartmentState,
    purchaseDate: IsDate.orNull.orUndefined,
    daysFromPurchase: IsNumber.orNull.orUndefined,
    emptyDaysAfterPurchase: IsNumber.orNull.orUndefined,
    daysFromFirstInvoice: IsNumber.orNull.orUndefined,
    daysOwned: IsNumber.orNull.orUndefined,
    daysOwnedPriced: IsNumber.orNull.orUndefined,
    contractEnds: IsDate.orNull.orUndefined,
    purchasePrice: IsNumber.orNull.orUndefined,
    currentPrice: IsNumber.orNull.orUndefined,
    currentRent: IsNumber.orNull.orUndefined,
    expensesSum: IsNumber,
    incomeSum: IsNumber,
    profitSum: IsNumber,
    annualAvgProfitYield: IsNumber.orNull.orUndefined,
    annualCurrentRentYield: IsNumber.orNull.orUndefined,
    vacancy: IsNumber.orNull.orUndefined,
    priceIncrease: IsNumber.orNull.orUndefined,
    annualAvgPriceIncrease: IsNumber.orNull.orUndefined,
    annualYield: IsNumber.orNull.orUndefined,
    byYear: IsArray(IsGetApartmentsResultApartmentFinancialsRow)
})
export type GetApartmentsResultApartmentFinancials = typeof IsGetApartmentsResultApartmentFinancials.infer

export const IsGetApartmentFinancialsResult = IsObject({
    summary: IsFinancialsSummary,
    rows: IsArray(IsGetApartmentsResultApartmentFinancials)
})
export type GetApartmentFinancialsResult = typeof IsGetApartmentFinancialsResult.infer

export const IsDeleteApartmentRequest = IsObject({
    id: IsApartmentId
})
export type DeleteApartmentRequest = typeof IsDeleteApartmentRequest.infer

export const IsGetApartmentRequest = IsObject({
    id: IsApartmentId
})
export type GetApartmentRequest = typeof IsGetApartmentRequest.infer

export const IsSyncApartmentFeature = IsObject({
    id: IsApartmentFeatureId.orUndefined,
    type: IsApartmentFeatureType,
    name: IsString,
    size: IsNumber.orNull.orUndefined,
    description: IsString.orNull.orUndefined
})

export const IsApartmentInsuranceRows = IsObject({
    isCompensatedByClient: IsBit,
    periodStart: IsDate,
    periodEnd: IsDate,
    sum: IsNumber,
    vat: IsNumber.orNull,
    sumWithVat: IsNumber,
    expenseId: IsExpenseId.orUndefined,
    expenseRowId: IsExpenseRowId.orUndefined
})

export const IsSyncApartmentData = IsObject({
    id: IsApartmentId.orNull.orUndefined,
    buildingId: IsBuildingId,
    buildingAddress: IsString.orNull.orUndefined,
    bookkeepingReference: IsString.maxLength(16).orNull,
    address: IsString,
    size: IsNumber.orNull,
    rooms: IsNumber.orNull,
    floor: IsNumber.orNull,
    state: IsApartmentState,
    ownerId: IsOwnerId.orNull.orUndefined,
    description: IsString.orNull,
    vat: IsNumber.orNull,
    vatScheme: IsApartmentVatScheme,
    invoicingScheme: IsApartmentInvoicingScheme,
    purchasePrice: IsNumber.orNull.orUndefined,
    purchaseDate: IsDate.orNull.orUndefined,
    currentPrice: IsNumber.orNull.orUndefined,
    currentPriceUpdated: IsDate.orNull.orUndefined,
    soldDate: IsDate.orNull.orUndefined,
    features: IsArray(IsSyncApartmentFeature).orNull.orUndefined,
    expectedExpenses: IsArray(IsApartmentExpectedExpense),
    insuranceRows: IsArray(IsApartmentInsuranceRows).orNull.orUndefined
})
export type SyncApartmentData = typeof IsSyncApartmentData.infer

export const IsSyncApartmentDataResponse = IsObject({
    id: IsApartmentId
})
export type SyncApartmentDataResponse = typeof IsSyncApartmentDataResponse.infer

export const IsGetApartmentsForSelectRequest = IsObject({
    ids: IsArray(IsApartmentId).orNull.orUndefined,
    addOwner: IsBoolean.orNull.orUndefined
}).orUndefined.default({})
export type GetApartmentsForSelectRequest = typeof IsGetApartmentsForSelectRequest.infer

export const IsApartmentRow = IsObject({
    id: IsApartmentId,
    name: IsString
})
export type ApartmentRow = typeof IsApartmentRow.infer

export const IsGetApartmentsForSelectResponse = IsObject({
    rows: IsArray(IsApartmentRow)
})
export type GetApartmentsForSelectResponse = typeof IsGetApartmentsForSelectResponse.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const ApartmentApiContract = new GGContractClass("ApartmentApi", {
    list: {
        input: IsGetApartments2Query,
        success: IsGetApartments2Result,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    getApartmentsFinancials: {
        input: IsGetApartmentsFinancialsQuery,
        success: IsGetApartmentFinancialsResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    getForSelect: {
        input: IsGetApartmentsForSelectRequest,
        success: IsGetApartmentsForSelectResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    sync: {
        input: IsSyncApartmentData,
        success: IsSyncApartmentDataResponse,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    get: {
        input: IsGetApartmentRequest,
        success: IsSyncApartmentData,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    delete: {
        input: IsDeleteApartmentRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const ApartmentApi = new GGHttpSchema({
    contract: ApartmentApiContract,
    pathPrefix: "gg/apartment",
    use: [GG_USER_AUTH, GG_COMPANY_AUTH_TOKEN],
    routes: {
        list: GGRpc.POST("list"),
        getApartmentsFinancials: GGRpc.POST("getApartmentsFinancials"),
        getForSelect: GGRpc.POST("getForSelect"),
        sync: GGRpc.POST("sync"),
        get: GGRpc.POST("get"),
        delete: GGRpc.POST("delete")
    },
})

