import {GGRpc, httpSchema} from "@grest-ts/http";
import {IsArray, IsObject, IsString, IsNumber, IsEnum, IsBit, IsLiteral, IsTuple, GGContractClass, FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema";
import {IsCompanyId} from "./CompanyApi";
import {IsEmail, IsPhone, IsUserId} from "../Brands";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";

// ---------------------------------------------------------
// Type Schemas - IDs
// ---------------------------------------------------------

export const IsCompanyUserId = IsNumber.brand("CompanyUserId");
export type tCompanyUserId = typeof IsCompanyUserId.infer

export const IsCompanyAuthToken = IsString.brand("CompanyAuthToken");

// Branded types imported from Brands

// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum CompanyUserState {
    ACTIVE = "active",
    DELETED = "deleted"
}

const IsCompanyUserState = IsEnum(CompanyUserState)

export enum CompanyUserPermission {
    access = "access",
    allUsers = "allUsers",
    inviteUsers = "inviteUsers",
    companyUsers = "companyUsers",
    editCompanyUsers = "editCompanyUsers",
    apartments = "apartments",
    editApartment = "editApartment",
    buildings = "buildings",
    editBuilding = "editBuilding",
    editCompany = "editCompany",
    expenses = "expenses",
    editExpense = "editExpense",
    clients = "clients",
    editClient = "editClient",
    contracts = "contracts",
    editContract = "editContract",
    invoices = "invoices",
    editInvoices = "editInvoices",
    payments = "payments",
    editPayments = "editPayments",
    expenseDocuments = "expenseDocuments",
    editExpenseDocuments = "editExpenseDocuments",
    owners = "owners",
    editOwner = "editOwner",
    ownerExpenses = "ownerExpenses",
    editOwnerExpenses = "editOwnerExpenses",
    auditLog = "auditLog",
    templates = "templates",
    editTemplate = "editTemplate",
    configureBookkeepingIntegrations = "configureBookkeepingIntegrations",
    useBookkeepingIntegrations = "useBookkeepingIntegrations",
    sendCustomEmails = "sendCustomEmails",
    configureCompanyEmails = "configureCompanyEmails",
    tasks = "tasks",
    editTasks = "editTasks",
    editOthersTasks = "editOthersTasks",
    financialOverviewReport = "financialOverviewReport",
    apartmentsOverviewReport = "apartmentsOverviewReport",
    ownerSalesReport = "ownerSalesReport",
    monthReport = "monthReport",
    balanceReport = "balanceReport",
    configureBankIntegrations = "configureBankIntegrations",
    developer = "developer"
}

export const IsCompanyUserPermission = IsEnum(CompanyUserPermission)

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsCompanyUserGetForSelectRequest = IsObject({
    search: IsString.orUndefined,
    isTaskAssignee: IsBit.orUndefined
}).orUndefined.default({})
export type CompanyUserGetForSelectRequest = typeof IsCompanyUserGetForSelectRequest.infer

export const IsCompanyUserGetForSelectResponseRow = IsObject({
    id: IsUserId,
    name: IsString
})

export const IsCompanyUserGetForSelectResponse = IsObject({
    rows: IsArray(IsCompanyUserGetForSelectResponseRow)
})
export type CompanyUserGetForSelectResponse = typeof IsCompanyUserGetForSelectResponse.infer

export const IsCompanyUserListRequest = IsObject({
    id: IsCompanyUserId.orNull.orUndefined,
    search: IsString.orNull.orUndefined,
    orderBy: IsObject({
        field: IsLiteral("displayName", "email", "phone", "state"),
        dir: IsLiteral("asc", "desc").orUndefined
    }).orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orUndefined
}).orUndefined
export type CompanyUserListRequest = typeof IsCompanyUserListRequest.infer

export const IsCompanyUserGetRequest = IsObject({
    id: IsCompanyUserId
})
export type CompanyUserGetRequest = typeof IsCompanyUserGetRequest.infer

export const IsCompanyUsersResultRow = IsObject({
    id: IsCompanyUserId,
    displayName: IsString,
    firstName: IsString,
    lastName: IsString,
    email: IsString,
    phone: IsString.orNull,
    isOwner: IsBit,
    isTaskAssignee: IsBit,
    state: IsCompanyUserState
})

export const IsCompanyUsersResponse = IsObject({
    rows: IsArray(IsCompanyUsersResultRow)
})
export type CompanyUsersResponse = typeof IsCompanyUsersResponse.infer

export const IsCompanyUser = IsObject({
    id: IsCompanyUserId,
    displayName: IsString,
    firstName: IsString,
    lastName: IsString,
    email: IsEmail,
    phone: IsPhone.orNull,
    comment: IsString,
    state: IsCompanyUserState,
    isOwner: IsBit,
    isTaskAssignee: IsBit,
    permissions: IsArray(IsCompanyUserPermission)
})
export type CompanyUser = typeof IsCompanyUser.infer

export const IsUpdateCompanyUserRequest = IsObject({
    id: IsCompanyUserId,
    state: IsCompanyUserState,
    comment: IsString.orNull.default(""),
    isOwner: IsBit,
    isTaskAssignee: IsBit,
    permissions: IsArray(IsCompanyUserPermission)
})
export type UpdateCompanyUserRequest = typeof IsUpdateCompanyUserRequest.infer

export const IsCompanyAuthRequest = IsObject({
    companyId: IsCompanyId
})
export type CompanyAuthRequest = typeof IsCompanyAuthRequest.infer

export const IsAuthCompany = IsObject({
    companyId: IsCompanyId,
    isOwner: IsBit,
    permissions: IsArray(IsCompanyUserPermission)
})
export type AuthCompany = typeof IsAuthCompany.infer

export const IsAuthCompanyJwt = IsObject({
    company: IsAuthCompany,
    checksum: IsString
})
export type AuthCompanyJwt = typeof IsAuthCompanyJwt.infer

export const IsCreateCompanyUserRequest = IsObject({
    email: IsEmail,
    comment: IsString,
    isOwner: IsBit,
    isTaskAssignee: IsBit,
    permissions: IsArray(IsCompanyUserPermission)
})
export type CreateCompanyUserRequest = typeof IsCreateCompanyUserRequest.infer

export const IsCreateCompanyUserResponse = IsObject({
    id: IsCompanyUserId
})
export type CreateCompanyUserResponse = typeof IsCreateCompanyUserResponse.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const CompanyUserApiContract = new GGContractClass("CompanyUserApi", {
    login: {
        input: IsCompanyAuthRequest,
        success: IsAuthCompanyJwt,
        errors: [NOT_FOUND, VALIDATION_ERROR, SERVER_ERROR]
    },
    getForSelect: {
        input: IsCompanyUserGetForSelectRequest,
        success: IsCompanyUserGetForSelectResponse,
        errors: [NOT_AUTHORIZED, VALIDATION_ERROR, SERVER_ERROR]
    },
    list: {
        input: IsCompanyUserListRequest,
        success: IsCompanyUsersResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    get: {
        input: IsCompanyUserGetRequest,
        success: IsCompanyUser,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    update: {
        input: IsUpdateCompanyUserRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    create: {
        input: IsCreateCompanyUserRequest,
        success: IsCreateCompanyUserResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const CompanyUserApi = httpSchema(CompanyUserApiContract)
    .pathPrefix("gg/companyUser")
    .use(GG_USER_AUTH)
    .use(GG_COMPANY_AUTH_TOKEN)
    .routes({
        login: GGRpc.POST("login"),
        getForSelect: GGRpc.POST("getForSelect"),
        list: GGRpc.POST("list"),
        get: GGRpc.POST("get"),
        update: GGRpc.POST("update"),
        create: GGRpc.POST("create")
    })

