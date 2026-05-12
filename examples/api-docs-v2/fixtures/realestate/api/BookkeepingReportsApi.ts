import {GGRpc, httpSchema} from "@grest-ts/http";
import {IsArray, IsObject, IsString, IsNumber, IsBoolean, IsEnum, IsLiteral, GGContractClass, FORBIDDEN, NOT_AUTHORIZED, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/schema";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsApartmentFeatureId, IsApartmentId, IsClientId, IsContractId, IsDate, IsExpenseFileId, IsExpenseId, IsInvoiceId, IsInvoiceRowId, IsOwnerExpenseId, IsPaymentId, IsYearMonth} from "../Brands";
import {IsOwnerId} from "./OwnerApi";
import {IsCompanyId} from "./CompanyApi";
import {InvoiceRowType} from "./InvoicesApi";
import {ExpenseType} from "./ExpenseApi";
import {PaymentType} from "./PaymentApi";
import {ClientType} from "./ClientApi";
import {ApartmentState} from "./ApartmentApi";
import {ApartmentFeatureType} from "./ApartmentFeaturesApi";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";

// ---------------------------------------------------------
// Enums (local schema versions of external enums)
// ---------------------------------------------------------

const IsInvoiceRowType = IsEnum(InvoiceRowType)
const IsExpenseType = IsEnum(ExpenseType)
const IsPaymentType = IsEnum(PaymentType)
const IsClientType = IsEnum(ClientType)
const IsApartmentState = IsEnum(ApartmentState)
const IsApartmentFeatureType = IsEnum(ApartmentFeatureType)

// ---------------------------------------------------------
// Type Schemas - Requests
// ---------------------------------------------------------

export const IsMonthReportRequest = IsObject({
    yearMonth: IsYearMonth
})
export type MonthReportRequest = typeof IsMonthReportRequest.infer

export const IsBalanceReportRequest = IsObject({
    date: IsDate
})
export type BalanceReportRequest = typeof IsBalanceReportRequest.infer

export const IsOwnerSalesReportRequest = IsObject({
    yearMonth: IsYearMonth,
    showVAT: IsBoolean
})
export type OwnerSalesReportRequest = typeof IsOwnerSalesReportRequest.infer

// ---------------------------------------------------------
// Type Schemas - MonthReport Response
// ---------------------------------------------------------

export const IsSumVatRow = IsObject({
    sum: IsNumber,
    vat: IsNumber.orNull,
    sumWithVat: IsNumber
})
export type SumVatRow = typeof IsSumVatRow.infer

export const IsMonthReportSalesRow = IsObject({
    id: IsInvoiceId,
    invoiceNo: IsString,
    date: IsDate,
    entryDate: IsDate,
    toClientId: IsClientId,
    toClientRefNo: IsString,
    toClientName: IsString,
    toClientCode: IsString.orNull.orUndefined,
    toClientVatNo: IsString.orNull.orUndefined,
    toClientType: IsClientType,
    toContractId: IsContractId.orNull,
    toContractRefNo: IsString,
    toName: IsString,
    toCode: IsString.orNull.orUndefined,
    toVatNo: IsString.orNull.orUndefined,
    type: IsInvoiceRowType,
    title: IsString,
    articleCode: IsString.orNull.orUndefined,
    sum: IsNumber,
    vat: IsNumber.orNull.orUndefined,
    sumWithVat: IsNumber,
    sendToTaxReporting: IsLiteral(0, 1)
})
export type MonthReportSalesRow = typeof IsMonthReportSalesRow.infer

export const IsMonthReportExpenseCompensationRow = IsObject({
    id: IsInvoiceId,
    invoiceNo: IsString,
    date: IsDate,
    entryDate: IsDate,
    byClientId: IsClientId,
    byClientRefNo: IsString,
    byClientName: IsString,
    byClientCode: IsString.orNull.orUndefined,
    byClientVatNo: IsString.orNull.orUndefined,
    byClientType: IsClientType,
    byContractId: IsContractId.orNull,
    byContractRefNo: IsString,
    toName: IsString,
    toCode: IsString.orNull.orUndefined,
    toVatNo: IsString.orNull.orUndefined,
    type: IsLiteral(InvoiceRowType.expense),
    title: IsString,
    sum: IsNumber,
    vat: IsNumber.orNull.orUndefined,
    sumWithVat: IsNumber,
    articleCode: IsString.orNull.orUndefined,
    expenseId: IsExpenseId.orNull.orUndefined,
    expenseInvoiceNo: IsString.orNull.orUndefined,
    expenseFromName: IsString.orNull.orUndefined,
    expenseReferenceNo: IsString.orNull.orUndefined,
    expensePayToAccount: IsString.orNull.orUndefined
})
export type MonthReportExpenseCompensationRow = typeof IsMonthReportExpenseCompensationRow.infer

export const IsMonthReportDepositRow = IsObject({
    id: IsInvoiceId,
    invoiceNo: IsString,
    date: IsDate,
    entryDate: IsDate,
    clientId: IsClientId,
    clientRefNo: IsString,
    clientName: IsString,
    clientCode: IsString.orNull.orUndefined,
    clientType: IsClientType,
    contractId: IsContractId.orNull,
    contractRefNo: IsString,
    toName: IsString,
    toCode: IsString.orNull.orUndefined,
    articleCode: IsString.orNull.orUndefined,
    sumWithVat: IsNumber
})
export type MonthReportDepositRow = typeof IsMonthReportDepositRow.infer

export const IsMonthReportExpenseRow = IsObject({
    id: IsExpenseId,
    date: IsDate,
    entryDate: IsDate,
    invoiceNo: IsString.orNull.orUndefined,
    referenceNo: IsString.orNull.orUndefined,
    fromName: IsString,
    fromRegCode: IsString.orNull.orUndefined,
    fromVatNo: IsString.orNull.orUndefined,
    payToAccount: IsString.orNull.orUndefined,
    fileId: IsExpenseFileId.orNull,
    apartmentId: IsApartmentId,
    apartmentAddress: IsString,
    title: IsString,
    articleCode: IsString.orNull.orUndefined,
    type: IsExpenseType,
    sum: IsNumber,
    vat: IsNumber.orNull.orUndefined,
    sumWithVat: IsNumber,
    sendToTaxReporting: IsBoolean
})
export type MonthReportExpenseRow = typeof IsMonthReportExpenseRow.infer

export const IsMonthReportPaymentRow = IsObject({
    id: IsPaymentId,
    date: IsDate,
    fromClientId: IsClientId,
    fromClientRefNo: IsString,
    fromClientName: IsString,
    fromClientCode: IsString.orNull.orUndefined,
    fromClientType: IsClientType,
    fromContractId: IsContractId.orNull,
    fromContractRefNo: IsString,
    senderName: IsString.orNull,
    senderAccount: IsString.orNull,
    type: IsPaymentType,
    title: IsString,
    sum: IsNumber
})
export type MonthReportPaymentRow = typeof IsMonthReportPaymentRow.infer

export const IsMonthReportResponse = IsObject({
    company: IsObject({
        id: IsCompanyId,
        invoiceName: IsString,
        invoiceAddress: IsString,
        invoiceRegNo: IsString,
        invoiceVatNo: IsString.orNull.orUndefined
    }),
    yearMonth: IsYearMonth,
    sales: IsObject({
        rows: IsArray(IsMonthReportSalesRow),
        debitSumsByVat: IsArray(IsSumVatRow),
        creditSumsByVat: IsArray(IsSumVatRow)
    }),
    expenseCompensations: IsObject({
        rows: IsArray(IsMonthReportExpenseCompensationRow),
        sumsByVat: IsArray(IsSumVatRow)
    }),
    deposit: IsObject({
        rows: IsArray(IsMonthReportDepositRow),
        debitSum: IsNumber,
        creditSum: IsNumber
    }),
    expenses: IsObject({
        rows: IsArray(IsMonthReportExpenseRow),
        debitSumsByVat: IsArray(IsSumVatRow),
        creditSumsByVat: IsArray(IsSumVatRow)
    }),
    payments: IsObject({
        rows: IsArray(IsMonthReportPaymentRow),
        sum: IsNumber
    }),
    payout: IsObject({
        rows: IsArray(IsMonthReportPaymentRow),
        sum: IsNumber
    })
})
export type MonthReportResponse = typeof IsMonthReportResponse.infer

// ---------------------------------------------------------
// Type Schemas - BalanceReport Response
// ---------------------------------------------------------

export const IsBalanceReportResponseRow = IsObject({
    clientId: IsClientId,
    name: IsString,
    balance: IsNumber
})
export type BalanceReportResponseRow = typeof IsBalanceReportResponseRow.infer

export const IsBalanceReportResponse = IsObject({
    companyName: IsString,
    invoiceRegNo: IsString,
    invoiceVatNo: IsString.orNull.orUndefined,
    balanceAsOfDate: IsDate,
    rows: IsArray(IsBalanceReportResponseRow),
    depositRows: IsArray(IsBalanceReportResponseRow)
})
export type BalanceReportResponse = typeof IsBalanceReportResponse.infer

// ---------------------------------------------------------
// Type Schemas - OwnerSalesReport Response
// ---------------------------------------------------------

export const IsOwnerSalesReportResponseTotals = IsObject({
    totals: IsArray(IsObject({
        sum: IsNumber,
        vat: IsNumber.orNull,
        sumWithVat: IsNumber
    })),
    sumWithVat: IsNumber,
    sum: IsNumber,
    totalRows: IsNumber
})
export type OwnerSalesReportResponseTotals = typeof IsOwnerSalesReportResponseTotals.infer

export const IsOwnerSalesReportResponseTotalRow = IsObject({
    sum: IsNumber,
    vat: IsNumber.orNull.orUndefined,
    sumWithVat: IsNumber
})
export type OwnerSalesReportResponseTotalRow = typeof IsOwnerSalesReportResponseTotalRow.infer

export const IsOwnerSalesReportResponseInvoiceRow = IsObject({
    invoiceId: IsInvoiceId,
    invoiceNo: IsString,
    invoiceRowId: IsInvoiceRowId,
    sum: IsNumber,
    vat: IsNumber.orNull,
    sumWithVat: IsNumber
})
export type OwnerSalesReportResponseInvoiceRow = typeof IsOwnerSalesReportResponseInvoiceRow.infer

export const IsOwnerSalesReportResponseContractRow = IsObject({
    contractId: IsContractId,
    clientId: IsClientId,
    clientName: IsString,
    isOutsideOfContractPeriod: IsBoolean,
    isContainedInMainRent: IsBoolean.orUndefined,
    isContractApartmentExtra: IsBoolean.orUndefined,
    invoices: IsArray(IsOwnerSalesReportResponseInvoiceRow)
})
export type OwnerSalesReportResponseContractRow = typeof IsOwnerSalesReportResponseContractRow.infer

export const IsOwnerExpenseRow = IsObject({
    id: IsOwnerExpenseId,
    apartmentId: IsApartmentId,
    apartmentAddress: IsString,
    title: IsString,
    date: IsDate,
    sum: IsNumber
})
export type OwnerExpenseRow = typeof IsOwnerExpenseRow.infer

export const IsOwnerSalesReportResponseApartmentFeatureRow = IsObject({
    apartmentFeatureId: IsApartmentFeatureId,
    apartmentFeatureName: IsString,
    apartmentFeatureType: IsApartmentFeatureType,
    isRented: IsBoolean,
    rent: IsArray(IsOwnerSalesReportResponseContractRow),
    totals: IsArray(IsOwnerSalesReportResponseTotalRow),
    sumWithVat: IsNumber,
    sum: IsNumber,
    totalRows: IsNumber
})
export type OwnerSalesReportResponseApartmentFeatureRow = typeof IsOwnerSalesReportResponseApartmentFeatureRow.infer

export const IsOwnerSalesReportResponseApartmentRow = IsObject({
    apartmentId: IsApartmentId,
    apartmentAddress: IsString,
    apartmentState: IsApartmentState,
    isRented: IsBoolean,
    features: IsArray(IsOwnerSalesReportResponseApartmentFeatureRow),
    contracts: IsArray(IsOwnerSalesReportResponseContractRow),
    totals: IsArray(IsOwnerSalesReportResponseTotalRow),
    sumWithVat: IsNumber,
    sum: IsNumber,
    totalRows: IsNumber
})
export type OwnerSalesReportResponseApartmentRow = typeof IsOwnerSalesReportResponseApartmentRow.infer

export const IsOwnerSalesReportResponseRow = IsObject({
    ownerId: IsOwnerId.orNull,
    ownerName: IsString,
    managementFeePercentage: IsNumber.orNull,
    apartments: IsArray(IsOwnerSalesReportResponseApartmentRow),
    ownerExpenses: IsArray(IsOwnerExpenseRow),
    ownerExpensesSum: IsNumber,
    managementFee: IsNumber,
    ownerRevenue: IsNumber,
    transferToOwner: IsNumber,
    totals: IsArray(IsOwnerSalesReportResponseTotalRow),
    sumWithVat: IsNumber,
    sum: IsNumber,
    totalRows: IsNumber
})
export type OwnerSalesReportResponseRow = typeof IsOwnerSalesReportResponseRow.infer

export const IsOwnerSalesReportResponse = IsObject({
    companyName: IsString,
    invoiceRegNo: IsString,
    invoiceVatNo: IsString.orNull.orUndefined,
    yearMonth: IsYearMonth,
    showVAT: IsBoolean,
    owners: IsArray(IsOwnerSalesReportResponseRow),
    totalManagementFee: IsNumber,
    totalOwnersExpenses: IsNumber,
    totalOwnersRevenue: IsNumber,
    totalTransferToOwners: IsNumber,
    totals: IsArray(IsOwnerSalesReportResponseTotalRow),
    sumWithVat: IsNumber,
    sum: IsNumber,
    totalRows: IsNumber
})
export type OwnerSalesReportResponse = typeof IsOwnerSalesReportResponse.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const BookkeepingReportsApiContract = new GGContractClass("BookkeepingReportsApi", {
    monthReport: {
        input: IsMonthReportRequest,
        success: IsMonthReportResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    balanceReport: {
        input: IsBalanceReportRequest,
        success: IsBalanceReportResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    ownerSalesReport: {
        input: IsOwnerSalesReportRequest,
        success: IsOwnerSalesReportResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const BookkeepingReportsApi = httpSchema(BookkeepingReportsApiContract)
    .pathPrefix("gg/bookkeepingReports")
    .use(GG_USER_AUTH)
    .use(GG_COMPANY_AUTH_TOKEN)
    .routes({
        monthReport: GGRpc.POST("monthReport"),
        balanceReport: GGRpc.POST("balanceReport"),
        ownerSalesReport: GGRpc.POST("ownerSalesReport")
    })

