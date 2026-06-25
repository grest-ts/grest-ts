import {GGRpc, GGHttpSchema} from "@grest-ts/http";
import {IsArray, IsObject, IsString, IsNumber, IsEnum, IsLiteral, IsBoolean, GGContractClass, FORBIDDEN, NOT_AUTHORIZED, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/schema";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsBankIntegrationId, IsBankStatementId, IsBankStatementRowId, IsClientId, IsContractId, IsDate, IsPaymentId} from "../Brands";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";

// ---------------------------------------------------------
// Re-exports
// ---------------------------------------------------------


// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum BankIntegrationType {
    LHV = "lhv"
}

const IsBankIntegrationType = IsEnum(BankIntegrationType)

export enum BankParseUploadedAccountStatementFileType {
    LHV_CSV = "LHV_CSV",
    SWED_CSV = "SWED_CSV"
}

const IsBankParseUploadedAccountStatementFileType = IsEnum(BankParseUploadedAccountStatementFileType)

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsBankIntegrationRow = IsObject({
    id: IsBankIntegrationId,
    type: IsBankIntegrationType,
    clientCode: IsString,
    accountNo: IsString
})

export const IsBankIntegrationResponse = IsObject({
    rows: IsArray(IsBankIntegrationRow)
})
export type BankIntegrationResponse = typeof IsBankIntegrationResponse.infer

export const IsBankStatementRequest = IsObject({
    start: IsDate,
    end: IsDate
})
export type BankStatementRequest = typeof IsBankStatementRequest.infer

export const IsBankParserResultRow = IsObject({
    id: IsBankStatementId,
    statementRowId: IsBankStatementRowId,
    isIgnored: IsLiteral(0, 1),
    clientAccount: IsString,
    docNo: IsString,
    date: IsDate,
    sum: IsNumber,
    currency: IsString,
    referenceNo: IsString.orNull,
    title: IsString,
    bankCode: IsString,
    account: IsString,
    name: IsString,
    initialSender: IsString.orNull.orUndefined,
    importedPaymentId: IsPaymentId.orNull.orUndefined
})
export type BankParserResultRow = typeof IsBankParserResultRow.infer

export const IsBankStatementMatchedRow = IsObject({
    contractId: IsContractId,
    contractAddress: IsString,
    clientId: IsClientId,
    clientName: IsString,
    matchInfo: IsString
})
export type BankStatementMatchedRow = typeof IsBankStatementMatchedRow.infer

export const IsBankStatementOverrideRow = IsObject({
    isIgnored: IsBoolean,
    contractId: IsContractId.orNull
})
export type BankStatementOverrideRow = typeof IsBankStatementOverrideRow.infer

export const IsBankStatementResponse = IsObject({
    rows: IsArray(IsBankParserResultRow),
    matched: IsArray(IsBankStatementMatchedRow.orNull),
    overrides: IsArray(IsBankStatementOverrideRow.orNull)
})
export type BankStatementResponse = typeof IsBankStatementResponse.infer

export const IsBankParseUploadedAccountStatementRequest = IsObject({
    type: IsBankParseUploadedAccountStatementFileType,
    body: IsString
})
export type BankParseUploadedAccountStatementRequest = typeof IsBankParseUploadedAccountStatementRequest.infer

export const IsImportBankAccountStatementResponse = IsObject({
    noOfEntriesCreated: IsNumber,
    noOfEntriesSkipped: IsNumber,
    noOfEntriesWithError: IsNumber,
    errors: IsArray(IsObject({
        error: IsObject({type: IsString, msg: IsString.orUndefined}),
        row: IsBankParserResultRow
    }))
})
export type ImportBankAccountStatementResponse = typeof IsImportBankAccountStatementResponse.infer

export type BankIntegrationRow = typeof IsBankIntegrationRow.infer

// ---------------------------------------------------------
// Contract (HTTP-exposed methods only)
// ---------------------------------------------------------

export const BankIntegrationApiContract = new GGContractClass("BankIntegrationApi", {
    getIntegrations: {
        input: IsObject({}).orUndefined.default({}),
        success: IsBankIntegrationResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    getBankAccountStatement: {
        input: IsBankStatementRequest,
        success: IsBankStatementResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    parseUploadedBankAccountStatementFile: {
        input: IsBankParseUploadedAccountStatementRequest,
        success: IsBankStatementResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    importBankAccountStatement: {
        input: IsBankStatementResponse,
        success: IsImportBankAccountStatementResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const BankIntegrationApi = new GGHttpSchema({
    contract: BankIntegrationApiContract,
    pathPrefix: "gg/bankIntegration",
    use: [GG_USER_AUTH, GG_COMPANY_AUTH_TOKEN],
    routes: {
        getIntegrations: GGRpc.POST("getIntegrations"),
        getBankAccountStatement: GGRpc.POST("getBankAccountStatement"),
        parseUploadedBankAccountStatementFile: GGRpc.POST("parseUploadedBankAccountStatementFile"),
        importBankAccountStatement: GGRpc.POST("importBankAccountStatement")
    },
})

// ---------------------------------------------------------
// Internal-only types (not HTTP-exposed)
// ---------------------------------------------------------

export interface CreateContract {
    type: BankIntegrationType;
    code: string;
    country: string;
}

export interface HandleContracts {
    type: BankIntegrationType
}

