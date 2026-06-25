import {GGRpc, GGHttpSchema} from "@grest-ts/http";
import {GGFileUpload} from "@grest-ts/http-file";
import {IsArray, IsObject, IsString, IsNumber, IsEnum, GGContractClass, FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/schema";
import {IsFile} from "@grest-ts/schema-file";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsUploadedFileId} from "../Brands";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";


// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum UploadedFileParentType {
    building = "building",
    apartment = "apartment",
    client = "client",
    contract = "contract",
    task = "task",
    taskDelegation = "taskDelegation",
}

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsAnyUploadedFileParent = IsObject({
    type: IsEnum(UploadedFileParentType),
    id: IsNumber
})
export type AnyUploadedFileParent = typeof IsAnyUploadedFileParent.infer

export const IsListUploadedFileResponseRow = IsObject({
    id: IsUploadedFileId,
    created: IsString,
    title: IsString,
    fileName: IsString,
    downloadLink: IsString,
    iconLink: IsString.orNull.orUndefined,
    size: IsNumber,
    folder: IsString.orNull.orUndefined
})
export type ListUploadedFileResponseRow = typeof IsListUploadedFileResponseRow.infer

export const IsListUploadedFileResponse = IsObject({
    rows: IsArray(IsListUploadedFileResponseRow)
})
export type ListUploadedFileResponse = typeof IsListUploadedFileResponse.infer

const IsUploadableFile = IsFile.accept('.txt', '.pdf', '.bdoc', '.asice', '.jpg', '.jpeg', '.png', '.zip', '.7zip', '.rar');

export const IsUploadFileRequest = IsObject({
    parent: IsAnyUploadedFileParent,
    folder: IsString.orNull,
    files: IsArray(IsUploadableFile),
    icons: IsArray(IsUploadableFile)
})
export type UploadFileRequest = typeof IsUploadFileRequest.infer

export const IsDeleteUploadedFileRequest = IsObject({
    uploadedFileId: IsUploadedFileId
})
export type DeleteUploadedFileRequest = typeof IsDeleteUploadedFileRequest.infer

export const IsRenameFolderRequest = IsObject({
    parent: IsAnyUploadedFileParent,
    oldFolder: IsString,
    newFolder: IsString
})
export type RenameFolderRequest = typeof IsRenameFolderRequest.infer

export const IsRenameFileRequest = IsObject({
    uploadedFileId: IsUploadedFileId,
    title: IsString,
    folder: IsString.orNull
})
export type RenameFileRequest = typeof IsRenameFileRequest.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const UploadedFileApiContract = new GGContractClass("UploadedFileApi", {
    list: {
        input: IsAnyUploadedFileParent,
        success: IsListUploadedFileResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    upload: {
        input: IsUploadFileRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    delete: {
        input: IsDeleteUploadedFileRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    renameFolder: {
        input: IsRenameFolderRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    renameFile: {
        input: IsRenameFileRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const UploadedFileApi = new GGHttpSchema({
    contract: UploadedFileApiContract,
    pathPrefix: "gg/uploadedFiles",
    use: [GG_USER_AUTH, GG_COMPANY_AUTH_TOKEN],
    routes: {
        list: GGRpc.POST("list"),
        upload: GGFileUpload.POST("upload"),
        delete: GGRpc.POST("delete"),
        renameFolder: GGRpc.POST("renameFolder"),
        renameFile: GGRpc.POST("renameFile")
    },
})

