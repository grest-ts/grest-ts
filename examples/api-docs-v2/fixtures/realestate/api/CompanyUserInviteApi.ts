import {GGRpc, httpSchema} from "@grest-ts/http";
import {IsArray, IsObject, IsString, IsNumber, IsEnum, GGContractClass, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsCompanyId} from "./CompanyApi";
import {IsCompanyUserPermission} from "./CompanyUserApi";
import {IsCompanyUserInviteId} from "../Brands";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";

// ---------------------------------------------------------
// Re-export branded ID type
// ---------------------------------------------------------

export type tCompanyUserInviteId = typeof IsCompanyUserInviteId.infer

// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum CompanyUserInviteState {
    WAITING = "waiting",
    ACCEPTED = "accepted",
    REJECTED = "rejected",
    DELETED = "deleted"
}

const IsCompanyUserInviteState = IsEnum(CompanyUserInviteState)

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsCompanyUserInviteListRequest = IsObject({
    companyId: IsCompanyId
})
export type CompanyUserInviteListRequest = typeof IsCompanyUserInviteListRequest.infer

export const IsCompanyUserInvitesResultRow = IsObject({
    id: IsCompanyUserInviteId,
    createdTs: IsNumber,
    email: IsString,
    state: IsCompanyUserInviteState
})

export const IsCompanyUserInvitesResult = IsObject({
    rows: IsArray(IsCompanyUserInvitesResultRow)
})
export type CompanyUserInvitesResult = typeof IsCompanyUserInvitesResult.infer

export const IsCompanyUserInviteGetRequest = IsObject({
    companyId: IsCompanyId,
    id: IsCompanyUserInviteId
})
export type CompanyUserInviteGetRequest = typeof IsCompanyUserInviteGetRequest.infer

export const IsCompanyUserInvite = IsObject({
    id: IsCompanyUserInviteId,
    createdTs: IsNumber,
    email: IsString,
    state: IsCompanyUserInviteState,
    permissions: IsArray(IsCompanyUserPermission),
    comment: IsString.orNull
})
export type CompanyUserInvite = typeof IsCompanyUserInvite.infer

export const IsCompanyUserInviteUpdateRequest = IsCompanyUserInvite.merge(IsObject({
    companyId: IsCompanyId
}))
export type CompanyUserInviteUpdateRequest = typeof IsCompanyUserInviteUpdateRequest.infer

export const IsInviteResponse = IsObject({
    hash: IsString
})
export type InviteResponse = typeof IsInviteResponse.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const CompanyUserInviteApiContract = new GGContractClass("CompanyUserInviteApi", {
    list: {
        input: IsCompanyUserInviteListRequest,
        success: IsCompanyUserInvitesResult,
        errors: [NOT_AUTHORIZED, VALIDATION_ERROR, SERVER_ERROR]
    },
    get: {
        input: IsCompanyUserInviteGetRequest,
        success: IsCompanyUserInvite,
        errors: [NOT_AUTHORIZED, NOT_FOUND, VALIDATION_ERROR, SERVER_ERROR]
    },
    update: {
        input: IsCompanyUserInviteUpdateRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, VALIDATION_ERROR, SERVER_ERROR]
    },
    acceptInvite: {
        input: IsInviteResponse,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, VALIDATION_ERROR, SERVER_ERROR]
    },
    rejectInvite: {
        input: IsInviteResponse,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, VALIDATION_ERROR, SERVER_ERROR]
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const CompanyUserInviteApi = httpSchema(CompanyUserInviteApiContract)
    .pathPrefix("gg/companyUserInvite")
    .use(GG_USER_AUTH)
    .use(GG_COMPANY_AUTH_TOKEN)
    .routes({
        list: GGRpc.POST("list"),
        get: GGRpc.POST("get"),
        update: GGRpc.POST("update"),
        acceptInvite: GGRpc.POST("acceptInvite"),
        rejectInvite: GGRpc.POST("rejectInvite")
    })

