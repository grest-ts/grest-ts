import {GGRpc, httpSchema} from "@grest-ts/http";
import {IsArray, IsObject, IsString, IsNumber, IsLiteral, IsTuple, GGContractClass, FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsBankIntegrationId, IsBankStatementId, IsBankStatementRowId, IsDate, IsPaymentId} from "../Brands";
import {IsCompanyId} from "./CompanyApi";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";


// ---------------------------------------------------------
// Type Schemas - Requests
// ---------------------------------------------------------

export const IsBankStatementsQuery = IsObject({
    id: IsBankStatementId.orUndefined,
    start: IsDate.orUndefined,
    end: IsDate.orUndefined,
    search: IsString.orUndefined,
    isIgnored: IsLiteral(true, false).orUndefined,
    hasPayment: IsLiteral(true, false).orUndefined,
    orderBy: IsObject({
        field: IsLiteral("date", "name", "sum", "currency").orUndefined,
        dir: IsLiteral("asc", "desc").orUndefined
    }).orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orUndefined
})
export type BankStatementsQuery = typeof IsBankStatementsQuery.infer

export const IsGetBankStatementQuery = IsObject({
    id: IsBankStatementId
})
export type GetBankStatementQuery = typeof IsGetBankStatementQuery.infer

// ---------------------------------------------------------
// Type Schemas - Responses
// ---------------------------------------------------------

export const IsLinkedPayment = IsObject({
    id: IsPaymentId,
    date: IsDate,
    sum: IsNumber,
    title: IsString,
    fromClientName: IsString
})
export type LinkedPayment = typeof IsLinkedPayment.infer

export const IsBankStatementResultRow = IsObject({
    id: IsBankStatementId,
    created: IsString,
    changed: IsString,
    companyId: IsCompanyId,
    bankIntegrationId: IsBankIntegrationId.orNull,
    bank: IsString,
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
    initialSender: IsString.orNull,
    linkedPaymentIds: IsArray(IsPaymentId)
})
export type BankStatementResultRow = typeof IsBankStatementResultRow.infer

export const IsBankStatementsResult = IsObject({
    rows: IsArray(IsBankStatementResultRow)
})
export type BankStatementsResult = typeof IsBankStatementsResult.infer

export const IsSyncBankStatementData = IsObject({
    id: IsBankStatementId,
    created: IsString,
    changed: IsString,
    companyId: IsCompanyId,
    bankIntegrationId: IsBankIntegrationId.orNull,
    bank: IsString,
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
    initialSender: IsString.orNull,
    linkedPayments: IsArray(IsLinkedPayment).orUndefined
})
export type SyncBankStatementData = typeof IsSyncBankStatementData.infer

export const IsSyncBankStatementResult = IsObject({
    id: IsBankStatementId
})
export type SyncBankStatementResult = typeof IsSyncBankStatementResult.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const BankStatementApiContract = new GGContractClass("BankStatementApi", {
    list: {
        input: IsBankStatementsQuery,
        success: IsBankStatementsResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    get: {
        input: IsGetBankStatementQuery,
        success: IsSyncBankStatementData,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    sync: {
        input: IsSyncBankStatementData,
        success: IsSyncBankStatementResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const BankStatementApi = httpSchema(BankStatementApiContract)
    .pathPrefix("gg/bankStatement")
    .use(GG_USER_AUTH)
    .use(GG_COMPANY_AUTH_TOKEN)
    .routes({
        list: GGRpc.POST("list"),
        get: GGRpc.POST("get"),
        sync: GGRpc.POST("sync")
    })

