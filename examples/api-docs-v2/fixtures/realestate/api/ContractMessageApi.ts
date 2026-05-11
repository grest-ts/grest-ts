import {GGRpc, httpSchema} from "@grest-ts/http";
import {FORBIDDEN, GGContractClass, IsArray, IsEmail, IsLiteral, IsNumber, IsObject, IsString, IsTuple, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsApartmentId, IsBuildingId, IsClientId, IsContractId, IsContractMessageId, IsDate, IsTemplateId, IsInvoiceId, IsLanguage, IsUserId} from "../Brands";
import {IsTemplateType} from "./TemplateApi";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsGetContractMessagesQuery = IsObject({
    contractId: IsContractId
})
export type GetContractMessagesQuery = typeof IsGetContractMessagesQuery.infer

export const IsContractMessage = IsObject({
    id: IsContractMessageId,
    created: IsString,
    contractId: IsContractId,
    type: IsTemplateType,
    sentByUserId: IsUserId.orNull,
    sentByUser: IsString.orNull,
    invoiceId: IsInvoiceId.orNull.orUndefined,
    invoiceNo: IsString.orNull.orUndefined
})
export type ContractMessage = typeof IsContractMessage.infer

export const IsGetContractMessagesResponse = IsObject({
    rows: IsArray(IsContractMessage)
})
export type GetContractMessagesResponse = typeof IsGetContractMessagesResponse.infer

export const IsWelcomeEmailRequest = IsObject({
    contractId: IsContractId
})
export type WelcomeEmailRequest = typeof IsWelcomeEmailRequest.infer

export const IsGetReadyToSendInvoiceRequest = IsObject({
    id: IsInvoiceId.orUndefined,
    orderBy: IsObject({
        field: IsString.orUndefined,
        dir: IsLiteral("asc", "desc").orUndefined
    }).orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orUndefined
})
export type GetReadyToSendInvoiceRequest = typeof IsGetReadyToSendInvoiceRequest.infer

export const IsGetReadyToSendInvoicesRow = IsObject({
    id: IsInvoiceId,
    invoiceNo: IsString,
    date: IsDate,
    contractId: IsContractId,
    clientName: IsString,
    clientId: IsClientId,
    apartment: IsString,
    apartmentId: IsApartmentId,
    sumWithVat: IsNumber
})
export type GetReadyToSendInvoicesRow = typeof IsGetReadyToSendInvoicesRow.infer

export const IsGetReadyToSendInvoicesResult = IsObject({
    rows: IsArray(IsGetReadyToSendInvoicesRow)
})
export type GetReadyToSendInvoicesResult = typeof IsGetReadyToSendInvoicesResult.infer

export const IsSendInvoiceRequest = IsObject({
    invoiceId: IsInvoiceId
})
export type SendInvoiceRequest = typeof IsSendInvoiceRequest.infer

export const IsGetReadyToSendDebtProcessesRequest = IsObject({
    id: IsInvoiceId.orUndefined,
    orderBy: IsObject({
        field: IsString.orUndefined,
        dir: IsLiteral("asc", "desc").orUndefined
    }).orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orUndefined
})
export type GetReadyToSendDebtProcessesRequest = typeof IsGetReadyToSendDebtProcessesRequest.infer

export const IsSendEmailRowDebtProcessInvoice = IsObject({
    id: IsInvoiceId,
    contractId: IsContractId,
    invoiceNo: IsString,
    date: IsDate,
    dueDate: IsDate,
    sumWithVat: IsNumber
})
export type SendEmailRowDebtProcessInvoice = typeof IsSendEmailRowDebtProcessInvoice.infer

export const IsSendEmailRowDebtProcess = IsObject({
    id: IsContractId,
    clientName: IsString,
    clientId: IsClientId,
    apartment: IsString,
    apartmentId: IsApartmentId,
    rendinContractId: IsString.orNull,
    casaPayClientEmail: IsString.orNull,
    contractEndsInDays: IsNumber.orNull,
    lastMessageType: IsTemplateType.orNull,
    lastMessageDaysAgo: IsNumber.orNull,
    manualDebtHandling: IsLiteral(0, 1),
    balance: IsNumber,
    invoicesSum: IsNumber,
    futureInvoicesSum: IsNumber,
    overdueSum: IsNumber,
    depositSum: IsNumber,
    oldestInvoiceOverdueDays: IsNumber,
    overdueInvoices: IsArray(IsSendEmailRowDebtProcessInvoice),
    sendMessageType: IsTemplateType.orNull,
    messageComment: IsString.orNull
})
export type SendEmailRowDebtProcess = typeof IsSendEmailRowDebtProcess.infer

export const IsGetReadyToSendDebtProcessesResult = IsObject({
    rows: IsArray(IsSendEmailRowDebtProcess)
})
export type GetReadyToSendDebtProcessesResult = typeof IsGetReadyToSendDebtProcessesResult.infer

export const IsSendDebtProcessRequest = IsObject({
    contractId: IsContractId,
    type: IsTemplateType,
    overdueInvoiceIds: IsArray(IsInvoiceId)
})
export type SendDebtProcessRequest = typeof IsSendDebtProcessRequest.infer

export const IsContractEndingRequest = IsObject({
    id: IsContractId.orUndefined,
    orderBy: IsObject({
        field: IsString.orUndefined,
        dir: IsLiteral("asc", "desc").orUndefined
    }).orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orUndefined
})
export type ContractEndingRequest = typeof IsContractEndingRequest.infer

export const IsContractEndingResultRow = IsObject({
    id: IsContractId,
    contractEndsInDays: IsNumber,
    contractEnd: IsDate,
    clientName: IsString,
    clientId: IsClientId,
    apartment: IsString,
    apartmentId: IsApartmentId,
    sendMessageType: IsTemplateType.orNull
})
export type ContractEndingResultRow = typeof IsContractEndingResultRow.infer

export const IsContractEndingResult = IsObject({
    rows: IsArray(IsContractEndingResultRow)
})
export type ContractEndingResult = typeof IsContractEndingResult.infer

export const IsSendContractEndingEmailRequest = IsObject({
    contractId: IsContractId,
    sendMessageType: IsTemplateType
})
export type SendContractEndingEmailRequest = typeof IsSendContractEndingEmailRequest.infer

export const IsGetEmailAddressesRequest = IsObject({
    buildingIds: IsArray(IsBuildingId).orUndefined,
    apartmentIds: IsArray(IsApartmentId).orUndefined,
    contractIds: IsArray(IsContractId).orUndefined
})
export type GetEmailAddressesRequest = typeof IsGetEmailAddressesRequest.infer

export const IsGetEmailAddressesResponseRow = IsObject({
    buildingId: IsBuildingId,
    buildingAddress: IsString,
    apartmentId: IsApartmentId,
    apartmentAddress: IsString,
    contractId: IsContractId,
    contractEnd: IsDate,
    contractEndsInDays: IsNumber,
    clientId: IsClientId,
    clientLanguage: IsLanguage,
    clientName: IsString,
    clientEmail: IsEmail
})
export type GetEmailAddressesResponseRow = typeof IsGetEmailAddressesResponseRow.infer

export const IsGetEmailAddressesResponse = IsObject({
    rows: IsArray(IsGetEmailAddressesResponseRow)
})
export type GetEmailAddressesResponse = typeof IsGetEmailAddressesResponse.infer

export const IsSendCustomEmailRequest = IsObject({
    emails: IsArray(IsGetEmailAddressesResponseRow),
    emailTemplateId: IsTemplateId
})
export type SendCustomEmailRequest = typeof IsSendCustomEmailRequest.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const ContractMessageApiContract = new GGContractClass("ContractMessageApi", {
    list: {
        input: IsGetContractMessagesQuery,
        success: IsGetContractMessagesResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    sendWelcomeEmail: {
        input: IsWelcomeEmailRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    listReadyToSendInvoices: {
        input: IsGetReadyToSendInvoiceRequest,
        success: IsGetReadyToSendInvoicesResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    sendInvoiceEmail: {
        input: IsSendInvoiceRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    listReadyToSendDebtProcessEmails: {
        input: IsGetReadyToSendDebtProcessesRequest,
        success: IsGetReadyToSendDebtProcessesResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    sendDebtProcessEmail: {
        input: IsSendDebtProcessRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    listContractEndingEmail: {
        input: IsContractEndingRequest,
        success: IsContractEndingResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    sendContractEndingEmail: {
        input: IsSendContractEndingEmailRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    getEmailAddresses: {
        input: IsGetEmailAddressesRequest,
        success: IsGetEmailAddressesResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    sendCustomEmail: {
        input: IsSendCustomEmailRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const ContractMessageApi = httpSchema(ContractMessageApiContract)
    .pathPrefix("gg/contractMessage")
    .use(GG_USER_AUTH)
    .use(GG_COMPANY_AUTH_TOKEN)
    .routes({
        list: GGRpc.POST("list"),
        sendWelcomeEmail: GGRpc.POST("sendWelcomeEmail"),
        listReadyToSendInvoices: GGRpc.POST("listReadyToSendInvoices"),
        sendInvoiceEmail: GGRpc.POST("sendInvoiceEmail"),
        listReadyToSendDebtProcessEmails: GGRpc.POST("listReadyToSendDebtProcessEmails"),
        sendDebtProcessEmail: GGRpc.POST("sendDebtProcessEmail"),
        listContractEndingEmail: GGRpc.POST("listContractEndingEmail"),
        sendContractEndingEmail: GGRpc.POST("sendContractEndingEmail"),
        getEmailAddresses: GGRpc.POST("getEmailAddresses"),
        sendCustomEmail: GGRpc.POST("sendCustomEmail")
    })

