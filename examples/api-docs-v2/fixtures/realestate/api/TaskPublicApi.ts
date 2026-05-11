import {GGRpc, httpSchema} from "@grest-ts/http";
import {GGFileUpload} from "@grest-ts/http-file";
import {IsArray, IsObject, IsString, IsLiteral, GGContractClass, NOT_FOUND, VALIDATION_ERROR, SERVER_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";
import {IsFile} from "@grest-ts/schema-file";
import {IsTaskDelegationState} from "./TaskApi";

// ---------------------------------------------------------
// Type Schemas
// ---------------------------------------------------------

export const IsTaskPublicGetByTokenRequest = IsObject({
    token: IsString
})
export type TaskPublicGetByTokenRequest = typeof IsTaskPublicGetByTokenRequest.infer

export const IsTaskPublicFileRow = IsObject({
    fileName: IsString,
    downloadLink: IsString,
    iconLink: IsString.orNull.orUndefined,
})

export const IsTaskPublicGetByTokenResponse = IsObject({
    taskTitle: IsString,
    taskDescription: IsString.orNull,
    delegationDescription: IsString.orNull,
    state: IsTaskDelegationState,
    companyName: IsString,
    taskFiles: IsArray(IsTaskPublicFileRow),
    tenantName: IsString.orNull.orUndefined,
    tenantPhone: IsString.orNull.orUndefined,
})
export type TaskPublicGetByTokenResponse = typeof IsTaskPublicGetByTokenResponse.infer

export const IsTaskPublicRespondRequest = IsObject({
    token: IsString,
    action: IsLiteral("done", "problem"),
    note: IsString.orNull,
})
export type TaskPublicRespondRequest = typeof IsTaskPublicRespondRequest.infer

const IsUploadableFile = IsFile.accept('.txt', '.pdf', '.bdoc', '.asice', '.jpg', '.jpeg', '.png', '.zip', '.7zip', '.rar');

export const IsTaskPublicUploadFileRequest = IsObject({
    token: IsString,
    files: IsArray(IsUploadableFile),
    icons: IsArray(IsUploadableFile),
})
export type TaskPublicUploadFileRequest = typeof IsTaskPublicUploadFileRequest.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const TaskPublicApiContract = new GGContractClass("TaskPublicApi", {
    getByToken: {
        input: IsTaskPublicGetByTokenRequest,
        success: IsTaskPublicGetByTokenResponse,
        errors: [NOT_FOUND, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    respond: {
        input: IsTaskPublicRespondRequest,
        success: undefined as undefined,
        errors: [NOT_FOUND, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    uploadFile: {
        input: IsTaskPublicUploadFileRequest,
        success: undefined as undefined,
        errors: [NOT_FOUND, VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    }
})

// ---------------------------------------------------------
// API Definition (no auth middleware)
// ---------------------------------------------------------

export const TaskPublicApi = httpSchema(TaskPublicApiContract)
    .pathPrefix("gg/task/public")
    .routes({
        getByToken: GGRpc.POST("getByToken"),
        respond: GGRpc.POST("respond"),
        uploadFile: GGFileUpload.POST("uploadFile")
    })
