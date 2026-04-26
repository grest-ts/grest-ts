import {GGIssueInvalid, IsCountry, IsDate, IsDateTime, IsEmail, IsLanguage, IsNumber, IsString} from "@grest-ts/schema";
import {IsFile} from "@grest-ts/schema-file";

export const IsUserId = IsNumber.brand("UserId");
export type tUserId = typeof IsUserId.infer

export const IsBuildingId = IsNumber.brand("BuildingId");
export type tBuildingId = typeof IsBuildingId.infer

export const IsApartmentId = IsNumber.brand("ApartmentId");
export type tApartmentId = typeof IsApartmentId.infer

export const IsContractId = IsNumber.brand("ContractId");
export type tContractId = typeof IsContractId.infer

export const IsExpenseId = IsNumber.brand("ExpenseId");
export type tExpenseId = typeof IsExpenseId.infer

export const IsExpenseRowId = IsNumber.brand("ExpenseRowId");
export type tExpenseRowId = typeof IsExpenseRowId.infer

export const IsApartmentFeatureId = IsNumber.brand("ApartmentFeatureId");
export type tApartmentFeatureId = typeof IsApartmentFeatureId.infer

export const IsInsuranceId = IsNumber.brand("InsuranceId");
export type tInsuranceId = typeof IsInsuranceId.infer

export const IsOwnerExpenseId = IsNumber.brand("OwnerExpenseId");
export type tOwnerExpenseId = typeof IsOwnerExpenseId.infer

export const IsInvoiceFutureRowId = IsNumber.brand("InvoiceFutureRowId");
export type tInvoiceFutureRowId = typeof IsInvoiceFutureRowId.infer

export const IsClientId = IsNumber.brand("ClientId");
export type tClientId = typeof IsClientId.infer

export const IsInvoiceId = IsNumber.brand("InvoiceId");
export type tInvoiceId = typeof IsInvoiceId.infer

export const IsInvoiceRowId = IsNumber.brand("InvoiceRowId");
export type tInvoiceRowId = typeof IsInvoiceRowId.infer

export const IsExpenseFileId = IsNumber.brand("ExpenseFileId");
export type tExpenseFileId = typeof IsExpenseFileId.infer

export const IsPaymentId = IsNumber.brand("PaymentId");
export type tPaymentId = typeof IsPaymentId.infer

export const IsEmailId = IsNumber.brand("EmailId");
export type tEmailId = typeof IsEmailId.infer

export const IsPrepaymentId = IsNumber.brand("PrepaymentId");

export const IsBankStatementId = IsNumber.brand("BankStatementId");
export type tBankStatementId = typeof IsBankStatementId.infer

export const IsBankStatementRowId = IsString.brand("BankStatementRowId");
export type tBankStatementRowId = typeof IsBankStatementRowId.infer

export const IsBankIntegrationId = IsNumber.brand("BankIntegrationId");
export type tBankIntegrationId = typeof IsBankIntegrationId.infer

export const IsBookkeepingIntegrationId = IsNumber.brand("BookkeepingIntegrationId");
export type tBookkeepingIntegrationId = typeof IsBookkeepingIntegrationId.infer

export const IsExpenseCompensationId = IsNumber.brand("ExpenseCompensationId");

export const IsCompanyUserInviteId = IsNumber.brand("CompanyUserInviteId");

export const IsTemplateId = IsNumber.brand("TemplateId");
export type tTemplateId = typeof IsTemplateId.infer

export const IsContractExtraId = IsNumber.brand("ContractExtraId");
export type tContractExtraId = typeof IsContractExtraId.infer

export const IsContractMessageId = IsNumber.brand("ContractMessageId");
export type tContractMessageId = typeof IsContractMessageId.infer

export const IsBookkeepingExternalIdsId = IsNumber.brand("BookkeepingExternalIdsId");
export type tBookkeepingExternalIdsId = typeof IsBookkeepingExternalIdsId.infer

export const IsUploadedFileId = IsNumber.brand("UploadedFileId");
export type tUploadedFileId = typeof IsUploadedFileId.infer

export const IsTaskId = IsNumber.brand("TaskId");
export type tTaskId = typeof IsTaskId.infer

export const IsTaskDelegationId = IsNumber.brand("TaskDelegationId");
export type tTaskDelegationId = typeof IsTaskDelegationId.infer

export const IsTaskCommentId = IsNumber.brand("TaskCommentId");
export type tTaskCommentId = typeof IsTaskCommentId.infer

export const IsTaskReminderLogId = IsNumber.brand("TaskReminderLogId");
export type tTaskReminderLogId = typeof IsTaskReminderLogId.infer

export const IsPIDataId = IsString.brand("PIDataId");
export type tPIDataId = typeof IsPIDataId.infer

export const IsUserAuthToken = IsString.brand("UserAuthToken");
export type tUserAuthToken = typeof IsUserAuthToken.infer

// ---------------------------------------------------------
// Re-exported from @gg/schema
// ---------------------------------------------------------

export {IsDate, IsDateTime, IsEmail, IsLanguage, IsFile, IsCountry}
export type tDate = typeof IsDate.infer
export type tDateTime = typeof IsDateTime.infer
export type tEmail = typeof IsEmail.infer
export type tLanguage = typeof IsLanguage.infer
export type tFile = typeof IsFile.infer

// ---------------------------------------------------------
// Custom branded types
// ---------------------------------------------------------

const yearMonthError = new GGIssueInvalid("yearMonth", "Expected YYYY-MM format (e.g., '2024-01')");
export const IsYearMonth = IsString.regex(/^\d{4}-(0[1-9]|1[0-2])$/, yearMonthError).brand("YearMonth")
export type tYearMonth = typeof IsYearMonth.infer

export const IsPhone = IsString.brand("Phone")
export type tPhone = typeof IsPhone.infer

const currencyError = new GGIssueInvalid("realestate.currency", "Expected ISO 4217 currency code (e.g., 'EUR')");
export const IsCurrency = IsString.regex(/^[A-Z]{3}$/, currencyError).brand("Currency")
export type tCurrency = typeof IsCurrency.infer

export const IsPersonCode = IsString.trim.brand("PersonCode")
export type tPersonCode = typeof IsPersonCode.infer

export const IsRegCode = IsString.trim.brand("RegCode")
export type tRegCode = typeof IsRegCode.infer

export const IsVatNo = IsString.trim.brand("VatNo")
export type tVatNo = typeof IsVatNo.infer

export const IsCountry2 = IsCountry
export type tCountry2 = typeof IsCountry2.infer

export const IsInvoiceNo = IsString.brand("InvoiceNo")
export type tInvoiceNo = typeof IsInvoiceNo.infer

// ---------------------------------------------------------
// Shared validation issues
// ---------------------------------------------------------

export const regCodeError = new GGIssueInvalid("regCode", "Invalid registration code");
export const vatCodeError = new GGIssueInvalid("vatCode", "Invalid VAT code");