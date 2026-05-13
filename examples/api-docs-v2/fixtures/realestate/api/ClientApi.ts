import {GGRpc, httpSchema} from "@grest-ts/http";
import {FORBIDDEN, GGContractClass, GGIssueInvalid, IsArray, IsDiscriminated, IsEnum, IsLiteral, IsNumber, IsObject, IsString, IsTuple, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/schema";
import {IsCreatedAndChangedBy} from "./UserApi";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsApartmentId, IsClientId, IsCountry2, IsLanguage, IsRegCode, IsVatNo} from "../Brands";
import {isValidVatCode} from "../common/isValidVatCode";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";
import {isValidPersonCode} from "../common/isValidPersonCode";
import {isValidCompanyCode} from "../common/isValidCompanyCode";

// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum ClientType {
    business = "business",
    person = "person"
}

export const IsClientType = IsEnum(ClientType)

// ---------------------------------------------------------
// Type Schemas - Requests
// ---------------------------------------------------------

export const IsClientApiGetForSelectRequest = IsObject({
    ids: IsArray(IsClientId).orNull.orUndefined,
    search: IsString.orNull.orUndefined,
    relatedToApartmentId: IsApartmentId.orNull.orUndefined,
    isTenant: IsLiteral(true, false).orNull.orUndefined,
    isProvider: IsLiteral(true, false).orNull.orUndefined,
    isContractor: IsLiteral(true, false).orNull.orUndefined,
    isTaskTarget: IsLiteral(true, false).orNull.orUndefined
}).orUndefined.default({})
export type ClientApiGetForSelectRequest = typeof IsClientApiGetForSelectRequest.infer

export const IsClientApiGetRequest = IsObject({
    id: IsClientId
})
export type ClientApiGetRequest = typeof IsClientApiGetRequest.infer

export const IsClientApiDeleteRequest = IsObject({
    id: IsClientId
})
export type ClientApiDeleteRequest = typeof IsClientApiDeleteRequest.infer

export enum ClientFilterType {
    hasActiveContracts = "hasActiveContracts",
    all = "all"
}

export const IsClientsQuery = IsObject({
    id: IsClientId.orNull.orUndefined,
    search: IsString.orNull.orUndefined,
    isTenant: IsLiteral(true, false).orNull.orUndefined,
    isProvider: IsLiteral(true, false).orNull.orUndefined,
    isContractor: IsLiteral(true, false).orNull.orUndefined,
    filter: IsEnum(ClientFilterType).orNull.orUndefined,
    orderBy: IsObject({
        field: IsLiteral("name", "code", "email", "phone", "balance"),
        dir: IsLiteral("asc", "desc").orUndefined
    }).orNull.orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orNull.orUndefined
})
export type ClientsQuery = typeof IsClientsQuery.infer

// ---------------------------------------------------------
// Type Schemas - Responses
// ---------------------------------------------------------

export const IsClientRow = IsObject({
    id: IsClientId,
    name: IsString
})
export type ClientRow = typeof IsClientRow.infer

export const IsClientApiGetForSelectResponse = IsObject({
    rows: IsArray(IsClientRow)
})
export type ClientApiGetForSelectResponse = typeof IsClientApiGetForSelectResponse.infer

export const IsClientsResultRow = IsObject({
    id: IsClientId,
    type: IsClientType,
    name: IsString,
    country: IsCountry2,
    code: IsString.orNull,
    email: IsString.orNull,
    phone: IsString.orNull,
    language: IsLanguage,
    referenceNo: IsString,
    balance: IsNumber,
    created: IsString,
    changed: IsString,
    isTenant: IsLiteral(0, 1),
    isProvider: IsLiteral(0, 1),
    isContractor: IsLiteral(0, 1),
    isTaskTarget: IsLiteral(0, 1)
})
export type ClientsResultRow = typeof IsClientsResultRow.infer

export const IsClientsResult = IsObject({
    query: IsClientsQuery,
    rows: IsArray(IsClientsResultRow)
})
export type ClientsResult = typeof IsClientsResult.infer

const clientNameError = new GGIssueInvalid("clientName", "Invalid client name");
const clientCodeError = new GGIssueInvalid("clientCode", "Invalid registration/person code");
const clientVatCodeError = new GGIssueInvalid("clientVatCode", "Invalid VAT code");

const commaList = (v: string) => v.split(",").map(s => s.trim()).join(", ")
const ucFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const fixName = (name: string) => name.trim().split(/([ -])/).map(p => p === " " || p === "-" ? p : ucFirst(p.toLowerCase())).join("")

const validNameParts = (name: string, pattern: RegExp) => !!name && name.split(",").every(n => pattern.test(n.trim()))
const IsBusinessName = IsString.trim.refine(v => validNameParts(v, /^[0-9a-z\u00f6\u00e4\u00fc\u00f5A-Z\u00d6\u00c4\u00dc\u00d5\s-]+$/), clientNameError)
const IsPersonName = IsString.trim
    .coerce(v => commaList(v.split(",").map(s => fixName(s)).join(",")))
    .refine(v => validNameParts(v, /^[a-z\u00f6\u00e4\u00fc\u00f5A-Z\u00d6\u00c4\u00dc\u00d5\s-]+$/), clientNameError)
const IsCommaList = IsString.trim.coerce(commaList)

const IsClientBase = IsObject({
    id: IsClientId.orUndefined,
    country: IsCountry2,
    phone: IsString.trim.orNull,
    email: IsString.trim.orNull,
    language: IsLanguage,
    referenceNo: IsString.orNull.orUndefined,
    address: IsString.trim.orNull,
    comment: IsString.orNull,
    balance: IsNumber.default(0),
    isTenant: IsLiteral(0, 1),
    isProvider: IsLiteral(0, 1).default(0),
    isContractor: IsLiteral(0, 1).default(0),
    isTaskTarget: IsLiteral(0, 1).default(0)
}).merge(IsCreatedAndChangedBy)

const IsBusinessClientData = IsClientBase.merge(IsObject({
    type: ClientType.business as const,
    name: IsBusinessName,
    code: IsRegCode.orNull,
    vatNo: IsVatNo.orNull.orUndefined,
}))
    .refine(obj => !obj.code || isValidCompanyCode(obj.code, obj.country), clientCodeError)
    .refine(obj => isValidVatCode(obj.vatNo, obj.country), clientVatCodeError)

const IsPersonClientData = IsClientBase.merge(IsObject({
    type: ClientType.person as const,
    name: IsPersonName,
    code: IsString.trim.coerce(commaList).brand("PersonCode").orNull,
    phone: IsCommaList.orNull,
    email: IsCommaList.orNull,
}))
    .refine(obj => !obj.code || isValidPersonCode(obj.code, obj.country), clientCodeError)

export type BusinessClientData = typeof IsBusinessClientData.infer
export type PersonClientData = typeof IsPersonClientData.infer

export const IsSyncClientData = IsDiscriminated("type", {
    [ClientType.business]: IsBusinessClientData,
    [ClientType.person]: IsPersonClientData,
})
export type SyncClientData = typeof IsSyncClientData.infer

export const IsClientSyncResponse = IsObject({
    id: IsClientId
})
export type ClientSyncResponse = typeof IsClientSyncResponse.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const ClientApiContract = new GGContractClass("ClientApi", {
    getForSelect: {
        input: IsClientApiGetForSelectRequest,
        success: IsClientApiGetForSelectResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    list: {
        input: IsClientsQuery,
        success: IsClientsResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    get: {
        input: IsClientApiGetRequest,
        success: IsSyncClientData,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    sync: {
        input: IsSyncClientData,
        success: IsClientSyncResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    delete: {
        input: IsClientApiDeleteRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const ClientApi = httpSchema(ClientApiContract)
    .pathPrefix("gg/client")
    .use(GG_USER_AUTH)
    .use(GG_COMPANY_AUTH_TOKEN)
    .routes({
        getForSelect: GGRpc.POST("getForSelect"),
        list: GGRpc.POST("list"),
        get: GGRpc.POST("get"),
        sync: GGRpc.POST("sync"),
        delete: GGRpc.POST("delete")
    })

