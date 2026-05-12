import {httpSchema} from "@grest-ts/http"
import {GGFileUpload, GGFileDownload} from "@grest-ts/http-file"
import {GGContractClass, GGContractImplementation, IsArray, IsNumber, IsObject, IsString, VALIDATION_ERROR, SERVER_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";
import {IsFile} from "@grest-ts/schema-file";

// ---------------------------------------------------------
// Type Schemas
// ---------------------------------------------------------

// Single file upload
export const IsUploadFileRequest = IsObject({
    file: IsFile,
    description: IsString.orUndefined
})
export type UploadFileRequest = typeof IsUploadFileRequest.infer

export const IsUploadFileResponse = IsObject({
    fileName: IsString,
    mimeType: IsString,
    size: IsNumber,
    contentPreview: IsString, // First 100 chars of text content or "[binary]"
    description: IsString.orUndefined
})
export type UploadFileResponse = typeof IsUploadFileResponse.infer

// Multiple files + JSON metadata
export const IsUploadMultipleRequest = IsObject({
    files: IsArray(IsFile),
    metadata: IsObject({
        tags: IsArray(IsString),
        category: IsString
    })
})
export type UploadMultipleRequest = typeof IsUploadMultipleRequest.infer

export const IsUploadMultipleResponse = IsObject({
    uploadedFiles: IsArray(IsObject({
        fileName: IsString,
        mimeType: IsString,
        size: IsNumber
    })),
    metadata: IsObject({
        tags: IsArray(IsString),
        category: IsString
    })
})
export type UploadMultipleResponse = typeof IsUploadMultipleResponse.infer

// Image upload with constraints
export const IsUploadImageRequest = IsObject({
    image: IsFile.accept('image/*').maxSize(5 * 1024 * 1024) // 5MB max, images only
})
export type UploadImageRequest = typeof IsUploadImageRequest.infer

export const IsUploadImageResponse = IsObject({
    fileName: IsString,
    mimeType: IsString,
    size: IsNumber
})
export type UploadImageResponse = typeof IsUploadImageResponse.infer

// Download request schemas
export const IsDownloadFileRequest = IsObject({
    content: IsString,
    fileName: IsString,
    mimeType: IsString
})
export type DownloadFileRequest = typeof IsDownloadFileRequest.infer

export const IsDownloadByIdRequest = IsObject({
    id: IsString
})
export type DownloadByIdRequest = typeof IsDownloadByIdRequest.infer

// ---------------------------------------------------------
// Contract & API Interface
// ---------------------------------------------------------

export const FileUploadTestApiContract = new GGContractClass("FileUploadTestApi", {
    // Basic single file upload
    uploadFile: {
        input: IsUploadFileRequest,
        success: IsUploadFileResponse,
        errors: [VALIDATION_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    // Multiple files with JSON metadata
    uploadMultiple: {
        input: IsUploadMultipleRequest,
        success: IsUploadMultipleResponse,
        errors: [VALIDATION_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    // Image-only upload with size constraint
    uploadImage: {
        input: IsUploadImageRequest,
        success: IsUploadImageResponse,
        errors: [VALIDATION_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    // Download file (POST with JSON body, returns raw file)
    downloadFile: {
        input: IsDownloadFileRequest,
        success: IsFile,
        errors: [VALIDATION_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    // Download file by ID (GET with query params, returns raw file)
    downloadById: {
        input: IsDownloadByIdRequest,
        success: IsFile,
        errors: [VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    }
})

export type IFileUploadTestApi = GGContractImplementation<typeof FileUploadTestApiContract["methods"]>

export const FileUploadTestApi = httpSchema(FileUploadTestApiContract)
    .pathPrefix("api/file-upload-test")
    .routes({
        uploadFile: GGFileUpload.POST("upload"),
        uploadMultiple: GGFileUpload.POST("upload-multiple"),
        uploadImage: GGFileUpload.POST("upload-image"),
        downloadFile: GGFileDownload.POST("download"),
        downloadById: GGFileDownload.GET("download-by-id")
    })
