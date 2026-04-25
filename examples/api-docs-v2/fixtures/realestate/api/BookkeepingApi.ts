import {GGRpc, httpSchema} from "@grest-ts/http";
import {FORBIDDEN, GGContractClass, IsArray, IsBoolean, IsObject, IsString, NOT_AUTHORIZED, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsBookkeepingIntegrationId, IsClientId, IsDate, IsExpenseId, IsInvoiceId} from "../Brands";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";
// ---------------------------------------------------------
// Re-exports
// ---------------------------------------------------------


// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum BookkeepingExternalIdObjectType {
    client = "client",
    invoice = "invoice",
    expense = "expense"
}

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsBookkeepingIntegration = IsObject({
    id: IsBookkeepingIntegrationId,
    name: IsString
})
export type BookkeepingIntegration = typeof IsBookkeepingIntegration.infer

export const IsBookkeepingIntegrations = IsObject({
    rows: IsArray(IsBookkeepingIntegration)
})
export type BookkeepingIntegrations = typeof IsBookkeepingIntegrations.infer

export const IsSendInvoice = IsObject({
    integrationId: IsBookkeepingIntegrationId,
    invoiceId: IsInvoiceId
})
export type SendInvoice = typeof IsSendInvoice.infer

export const IsSendExpense = IsObject({
    integrationId: IsBookkeepingIntegrationId,
    expenseId: IsExpenseId
})
export type SendExpense = typeof IsSendExpense.infer

export const IsSyncClients = IsObject({
    integrationId: IsBookkeepingIntegrationId,
    save: IsBoolean
})
export type SyncClients = typeof IsSyncClients.infer

export const IsSyncInvoices = IsObject({
    integrationId: IsBookkeepingIntegrationId,
    save: IsBoolean,
    start: IsDate,
    end: IsDate
})
export type SyncInvoices = typeof IsSyncInvoices.infer

export const IsBookkeepingClientSyncResultClient = IsObject({
    id: IsClientId,
    name: IsString,
    code: IsString,
    vatNo: IsString,
    externalId: IsString
})
export type BookkeepingClientSyncResultClient = typeof IsBookkeepingClientSyncResultClient.infer

export const IsBookkeepingClientSyncResultClientExtClient = IsObject({
    extId: IsString,
    name: IsString
})
export type BookkeepingClientSyncResultClientExtClient = typeof IsBookkeepingClientSyncResultClientExtClient.infer

export const IsBookkeepingClientSyncResult = IsObject({
    saved: IsBoolean,
    alreadyMatched: IsArray(IsObject({client: IsBookkeepingClientSyncResultClient, extClient: IsBookkeepingClientSyncResultClientExtClient})),
    alreadyMatchedButNotFound: IsArray(IsBookkeepingClientSyncResultClient),
    toMatch: IsArray(IsObject({client: IsBookkeepingClientSyncResultClient, extClient: IsBookkeepingClientSyncResultClientExtClient})),
    toMatchNoMatchFound: IsArray(IsBookkeepingClientSyncResultClient),
    toMatchButMultipleFound: IsArray(IsObject({client: IsBookkeepingClientSyncResultClient, extClients: IsArray(IsBookkeepingClientSyncResultClientExtClient)}))
})
export type BookkeepingClientSyncResult = typeof IsBookkeepingClientSyncResult.infer

export const IsBookkeepingInvoiceSyncResultClient = IsObject({
    id: IsInvoiceId,
    invoiceNo: IsString,
    externalId: IsString
})

export const IsBookkeepingInvoiceSyncResultClientExtClient = IsObject({
    extId: IsString,
    invoiceNo: IsString
})
export type BookkeepingInvoiceSyncResultClientExtClient = typeof IsBookkeepingInvoiceSyncResultClientExtClient.infer

export const IsBookkeepingInvoiceSyncResult = IsObject({
    saved: IsBoolean,
    alreadyMatched: IsArray(IsObject({invoice: IsBookkeepingInvoiceSyncResultClient, extInvoice: IsBookkeepingInvoiceSyncResultClientExtClient})),
    alreadyMatchedButNotFound: IsArray(IsBookkeepingInvoiceSyncResultClient),
    toMatch: IsArray(IsObject({invoice: IsBookkeepingInvoiceSyncResultClient, extInvoice: IsBookkeepingInvoiceSyncResultClientExtClient})),
    toMatchNoMatchFound: IsArray(IsBookkeepingInvoiceSyncResultClient),
    toMatchButMultipleFound: IsArray(IsObject({invoice: IsBookkeepingInvoiceSyncResultClient, extInvoices: IsArray(IsBookkeepingInvoiceSyncResultClientExtClient)}))
})
export type BookkeepingInvoiceSyncResult = typeof IsBookkeepingInvoiceSyncResult.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const BookkeepingApiContract = new GGContractClass("BookkeepingApi", {
    syncClients: {
        input: IsSyncClients,
        success: IsBookkeepingClientSyncResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    syncInvoices: {
        input: IsSyncInvoices,
        success: IsBookkeepingInvoiceSyncResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    getIntegrations: {
        input: IsObject({}).orUndefined.default({}),
        success: IsBookkeepingIntegrations,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    sendInvoice: {
        input: IsSendInvoice,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    sendExpense: {
        input: IsSendExpense,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const BookkeepingApi = httpSchema(BookkeepingApiContract)
    .pathPrefix("gg/bookkeeping")
    .use(GG_USER_AUTH)
    .use(GG_COMPANY_AUTH_TOKEN)
    .routes({
        syncClients: GGRpc.POST("syncClients"),
        syncInvoices: GGRpc.POST("syncInvoices"),
        getIntegrations: GGRpc.POST("getIntegrations"),
        sendInvoice: GGRpc.POST("sendInvoice"),
        sendExpense: GGRpc.POST("sendExpense")
    })

