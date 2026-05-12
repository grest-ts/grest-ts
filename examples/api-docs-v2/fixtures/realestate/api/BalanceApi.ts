import {GGRpc, httpSchema} from "@grest-ts/http";
import {IsArray, IsObject, IsString, IsNumber, IsEnum, IsLiteral, IsDiscriminated, GGContractClass, FORBIDDEN, NOT_AUTHORIZED, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/schema";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsClientId, IsContractId, IsDate, IsInvoiceId, IsPaymentId} from "../Brands";
import {PaymentType} from "./PaymentApi";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";

// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum DocumentType {
    openingBalance = "openingBalance",
    invoice = "invoice",
    creditInvoice = "creditInvoice",
    payment = "payment",
}

const IsPaymentType = IsEnum(PaymentType)

// ---------------------------------------------------------
// Type Schemas - Requests
// ---------------------------------------------------------

export const IsBalanceRequest = IsObject({
    clientId: IsClientId,
    contractId: IsContractId.orUndefined,
    orderBy: IsObject({
        field: IsLiteral("id", "date", "entryDate").orUndefined,
        dir: IsLiteral("asc", "desc").orUndefined
    })
})
export type BalanceRequest = typeof IsBalanceRequest.infer

// ---------------------------------------------------------
// Type Schemas - Response Row Variants
// ---------------------------------------------------------

export const IsBalanceRowOpeningBalance = IsObject({
    id: IsContractId,
    type: IsLiteral(DocumentType.openingBalance),
    date: IsDate,
    entryDate: IsDate,
    change: IsNumber,
    balance: IsNumber,
    apartmentAddress: IsString
})
export type BalanceRowOpeningBalance = typeof IsBalanceRowOpeningBalance.infer

export const IsBalanceRowInvoice = IsObject({
    id: IsInvoiceId,
    type: IsLiteral(DocumentType.invoice, DocumentType.creditInvoice),
    date: IsDate,
    entryDate: IsDate,
    change: IsNumber,
    balance: IsNumber,
    invoiceNo: IsString,
    contractId: IsContractId,
    apartmentAddress: IsString.orUndefined
})
export type BalanceRowInvoice = typeof IsBalanceRowInvoice.infer

export const IsBalanceRowPayment = IsObject({
    id: IsPaymentId,
    type: IsLiteral(DocumentType.payment),
    date: IsDate,
    entryDate: IsDate,
    change: IsNumber,
    balance: IsNumber,
    subType: IsPaymentType,
    contractId: IsContractId,
    apartmentAddress: IsString
})
export type BalanceRowPayment = typeof IsBalanceRowPayment.infer

// ---------------------------------------------------------
// Type Schemas - Response
// ---------------------------------------------------------

export type AnyBalanceRow = BalanceRowOpeningBalance | BalanceRowInvoice | BalanceRowPayment

export const IsBalanceResponse = IsObject({
    rows: IsArray(IsDiscriminated("type", () => ({
        [DocumentType.openingBalance]: IsBalanceRowOpeningBalance,
        [DocumentType.invoice]: IsBalanceRowInvoice,
        [DocumentType.creditInvoice]: IsBalanceRowInvoice,
        [DocumentType.payment]: IsBalanceRowPayment
    })))
})
export type BalanceResponse = typeof IsBalanceResponse.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const BalanceApiContract = new GGContractClass("BalanceApi", {
    balance: {
        input: IsBalanceRequest,
        success: IsBalanceResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const BalanceApi = httpSchema(BalanceApiContract)
    .pathPrefix("gg/balance")
    .use(GG_USER_AUTH)
    .use(GG_COMPANY_AUTH_TOKEN)
    .routes({
        balance: GGRpc.POST("balance")
    })

