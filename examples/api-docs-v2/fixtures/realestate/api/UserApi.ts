import {GGRpc, httpSchema} from "@grest-ts/http";
import {FORBIDDEN, GGContractClass, IsArray, IsEnum, IsLiteral, IsNumber, IsObject, IsString, IsTuple, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";
import {IsUserId} from "../Brands";

export {IsUserAuthToken} from "../Brands";
export type {tUserAuthToken} from "../Brands";

// ---------------------------------------------------------
// Type Schemas - IDs
// ---------------------------------------------------------

// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum UserPermission {
    users = "users",
    addCompany = "addCompany",
    companies = "companies"
}

const IsUserPermission = IsEnum(UserPermission)

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsUserLoginRequest = IsObject({
    username: IsString,
    password: IsString
})
export type UserLoginRequest = typeof IsUserLoginRequest.infer

export const IsAuthUser = IsObject({
    id: IsUserId,
    username: IsString,
    permissions: IsArray(IsUserPermission)
})
export type AuthUser = typeof IsAuthUser.infer

export const IsAuthUserJwt = IsObject({
    user: IsAuthUser,
    checksum: IsString
})
export type AuthUserJwt = typeof IsAuthUserJwt.infer

export const IsUsersQuery = IsObject({
    id: IsUserId.orNull.orUndefined,
    search: IsString.orNull.orUndefined,
    orderBy: IsObject({
        field: IsLiteral("username", "displayName", "email", "phone").orUndefined,
        dir: IsLiteral("asc", "desc").orUndefined
    }).orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orUndefined
}).orUndefined
export type UsersQuery = typeof IsUsersQuery.infer

export const IsUsersListResponseRow = IsObject({
    id: IsUserId,
    username: IsString,
    displayName: IsString,
    firstName: IsString,
    lastName: IsString,
    email: IsString,
    phone: IsString.orNull.orUndefined
})

export const IsUsersListResponse = IsObject({
    rows: IsArray(IsUsersListResponseRow)
})
export type UsersListResponse = typeof IsUsersListResponse.infer

export const IsUserGetRequest = IsObject({
    id: IsUserId
})
export type UserGetRequest = typeof IsUserGetRequest.infer

export const IsGetUser = IsObject({
    id: IsUserId,
    username: IsString,
    displayName: IsString,
    firstName: IsString,
    lastName: IsString,
    email: IsString,
    phone: IsString.orNull.orUndefined,
    permissions: IsArray(IsUserPermission)
})
export type GetUser = typeof IsGetUser.infer

export const IsCreateUser = IsObject({
    username: IsString,
    password: IsString,
    displayName: IsString,
    firstName: IsString,
    lastName: IsString,
    email: IsString,
    phone: IsString,
    permissions: IsArray(IsUserPermission)
})
export type CreateUser = typeof IsCreateUser.infer

export const IsCreateUserResponse = IsObject({
    id: IsUserId
})
export type CreateUserResponse = typeof IsCreateUserResponse.infer

export const IsUser = IsObject({
    id: IsUserId,
    username: IsString,
    password: IsString,
    displayName: IsString,
    firstName: IsString,
    lastName: IsString,
    email: IsString,
    phone: IsString,
    permissions: IsArray(IsUserPermission)
})
export type User = typeof IsUser.infer

export const IsUpdateUser = IsObject({
    id: IsUserId,
    username: IsString,
    password: IsString.orUndefined,
    displayName: IsString,
    firstName: IsString,
    lastName: IsString,
    email: IsString,
    phone: IsString.orNull.orUndefined,
    permissions: IsArray(IsUserPermission)
})
export type UpdateUser = typeof IsUpdateUser.infer

export const IsCreatedAndChangedBy = IsObject({
    created: IsString.orUndefined,
    createdByUserId: IsUserId.orUndefined,
    createdByUser: IsString.orUndefined,
    changed: IsString.orUndefined,
    changedByUserId: IsUserId.orUndefined,
    changedByUser: IsString.orUndefined
})

// ---------------------------------------------------------
// Contracts
// ---------------------------------------------------------

export const UserPublicApiContract = new GGContractClass("UserPublicApi", {
    login: {
        input: IsUserLoginRequest,
        success: IsAuthUserJwt,
        errors: [NOT_FOUND, NOT_AUTHORIZED, VALIDATION_ERROR, SERVER_ERROR]
    }
})

export const UserAuthApiContract = new GGContractClass("UserAuthApi", {
    list: {
        input: IsUsersQuery,
        success: IsUsersListResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    get: {
        input: IsUserGetRequest,
        success: IsGetUser,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    create: {
        input: IsCreateUser,
        success: IsCreateUserResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    },
    update: {
        input: IsUpdateUser,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR]
    }
})

// ---------------------------------------------------------
// API Definitions
// ---------------------------------------------------------

export const UserPublicApi = httpSchema(UserPublicApiContract)
    .pathPrefix("gg/users")
    .routes({
        login: GGRpc.POST("login")
    })

export const UserAuthApi = httpSchema(UserAuthApiContract)
    .pathPrefix("gg/users/admin")
    .use(GG_USER_AUTH)
    .routes({
        list: GGRpc.POST("list"),
        get: GGRpc.POST("get"),
        create: GGRpc.POST("create"),
        update: GGRpc.POST("update")
    })

