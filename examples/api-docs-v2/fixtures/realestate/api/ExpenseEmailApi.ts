import {GGRpc, httpSchema} from "@grest-ts/http";
import {IsArray, IsObject, IsString, IsNumber, IsTuple, IsLiteral, GGContractClass, FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsEmailId} from "../Brands";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsEmailQuery = IsObject({
    id: IsEmailId.orUndefined,
    search: IsString.orUndefined,
    orderBy: IsObject({
        field: IsLiteral("created", "title"),
        dir: IsLiteral("asc", "desc").orUndefined
    }).orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orUndefined
})
export type EmailQuery = typeof IsEmailQuery.infer

export const IsEmailQueryResponseRow = IsObject({
    id: IsEmailId,
    created: IsString,
    title: IsString,
    from: IsString,
    to: IsString,
    noOfFiles: IsNumber
})
export type EmailQueryResponseRow = typeof IsEmailQueryResponseRow.infer

export const IsEmailQueryResponse = IsObject({
    rows: IsArray(IsEmailQueryResponseRow)
})
export type EmailQueryResponse = typeof IsEmailQueryResponse.infer

export const IsEmailGetRequest = IsObject({
    id: IsEmailId
})
export type EmailGetRequest = typeof IsEmailGetRequest.infer

export const IsEmailDeleteRequest = IsObject({
    id: IsEmailId
})
export type EmailDeleteRequest = typeof IsEmailDeleteRequest.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const ExpenseEmailApiContract = new GGContractClass("ExpenseEmailApi", {
    list: {
        input: IsEmailQuery,
        success: IsEmailQueryResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    get: {
        input: IsEmailGetRequest,
        success: IsEmailQueryResponseRow,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    delete: {
        input: IsEmailDeleteRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const ExpenseEmailApi = httpSchema(ExpenseEmailApiContract)
    .pathPrefix("gg/expenseEmail")
    .use(GG_USER_AUTH)
    .use(GG_COMPANY_AUTH_TOKEN)
    .routes({
        list: GGRpc.POST("list"),
        get: GGRpc.POST("get"),
        delete: GGRpc.POST("delete")
    })

