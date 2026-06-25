import {GGRpc, GGHttpSchema} from "@grest-ts/http"
import {FORBIDDEN, GGContractClass, IsArray, IsBoolean, IsLatitude, IsLongitude, IsObject, IsString, IsUint, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";
import {GG_USER_AUTH_TOKEN} from "./auth/UserAuth";

// ---------------------------------------------------------
// Type Schemas
// ---------------------------------------------------------

export const IsChecklistId = IsString.brand("ChecklistId")
export type tChecklistId = typeof IsChecklistId.infer

const IsUserId = IsString.brand("UserId")

export const IsChecklistItem = IsObject({
    id: IsChecklistId,
    userId: IsUserId,
    title: IsString,
    description: IsString.orUndefined,
    address: IsString.orUndefined,
    lat: IsLatitude.orUndefined,
    lng: IsLongitude.orUndefined,
    done: IsBoolean,
    createdAt: IsUint,
    updatedAt: IsUint
})
export type ChecklistItem = typeof IsChecklistItem.infer

export const IsAddChecklistRequest = IsObject({
    title: IsString.nonEmpty,
    description: IsString.orUndefined,
    address: IsString.orUndefined,
})
export type AddChecklistRequest = typeof IsAddChecklistRequest.infer

export const IsEditChecklistRequest = IsObject({
    id: IsChecklistId,
    title: IsString.orUndefined,
    description: IsString.orUndefined,
    address: IsString.orUndefined,
})
export type EditChecklistRequest = typeof IsEditChecklistRequest.infer

export const IsChecklistIdParam = IsObject({
    id: IsChecklistId,
})

// ---------------------------------------------------------
// Contract & API Interface
// ---------------------------------------------------------

export const ChecklistApiContract = new GGContractClass("ChecklistApi", {
    list: {
        success: IsArray(IsChecklistItem),
        errors: [NOT_AUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    add: {
        input: IsAddChecklistRequest,
        success: IsChecklistItem,
        errors: [NOT_AUTHORIZED, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    get: {
        input: IsChecklistIdParam,
        success: IsChecklistItem,
        errors: [NOT_AUTHORIZED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    edit: {
        input: IsEditChecklistRequest,
        success: IsChecklistItem,
        errors: [NOT_AUTHORIZED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    delete: {
        input: IsChecklistIdParam,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    markDone: {
        input: IsChecklistIdParam,
        success: IsChecklistItem,
        errors: [NOT_AUTHORIZED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    }
})

export const ChecklistApi = new GGHttpSchema({
    contract: ChecklistApiContract,
    pathPrefix: "api/checklist",
    use: [GG_USER_AUTH_TOKEN],
    routes: {
        list: GGRpc.GET("list"),
        add: GGRpc.POST("add"),
        get: GGRpc.GET("get/"),
        edit: GGRpc.PUT("edit"),
        delete: GGRpc.DELETE("delete/:id"),
        markDone: GGRpc.POST("markDone/:id")
    }
})
