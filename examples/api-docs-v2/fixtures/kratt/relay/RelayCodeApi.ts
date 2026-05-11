import {GGContractClass, IsObject, IsString, IsNumber, IsBoolean, IsArray, SERVER_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema"
import {GGRpc, httpSchema} from "@grest-ts/http"
import {GG_RELAY_TOKEN} from "./RelayAuthContext.js"

const IsWorkspaceIdRequest = IsObject({
    workspaceId: IsString,
})

const IsChangedFilesRequest = IsObject({
    workspaceId: IsString,
    diffBase: IsString.orUndefined,
    diffTarget: IsString.orUndefined,
})

const IsFileDiffRequest = IsObject({
    workspaceId: IsString,
    repo: IsString,
    path: IsString,
    diffBase: IsString.orUndefined,
    diffTarget: IsString.orUndefined,
})

const IsSaveFileRequest = IsObject({
    workspaceId: IsString,
    repo: IsString,
    path: IsString,
    content: IsString,
    expectedVersion: IsString,
})

const IsDiscardFileRequest = IsObject({
    workspaceId: IsString,
    repo: IsString,
    path: IsString,
})

const IsRepoTree = IsObject({
    repoName: IsString,
    files: IsArray(IsString),
})

const IsFileTreeResponse = IsObject({
    repos: IsArray(IsRepoTree),
})

const IsCommit = IsObject({
    hash: IsString,
    message: IsString,
    author: IsString,
    date: IsString,
    refs: IsString,
})

const IsRepoCommits = IsObject({
    repoName: IsString,
    branch: IsString,
    baseBranch: IsString,
    mergeBase: IsString,
    commits: IsArray(IsCommit),
})

const IsCommitsResponse = IsObject({
    repos: IsArray(IsRepoCommits),
})

const IsFileChange = IsObject({
    path: IsString,
    status: IsString,
    additions: IsNumber,
    deletions: IsNumber,
})

const IsRepoChanges = IsObject({
    repoName: IsString,
    branch: IsString,
    changes: IsArray(IsFileChange),
    unpushedCommits: IsNumber,
})

const IsChangedFilesResponse = IsObject({
    repos: IsArray(IsRepoChanges),
})

const IsFileDiffResponse = IsObject({
    original: IsString.orUndefined,
    modified: IsString.orUndefined,
    version: IsString,
})

const IsConflict = IsObject({
    currentContent: IsString,
    currentVersion: IsString,
})

const IsSaveFileResponse = IsObject({
    saved: IsBoolean,
    version: IsString,
    conflict: IsConflict.orUndefined,
})

export const RelayCodeApiContract = new GGContractClass("RelayCodeApi", {
    changedFiles: {
        input: IsChangedFilesRequest,
        success: IsChangedFilesResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    commits: {
        input: IsWorkspaceIdRequest,
        success: IsCommitsResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    fileDiff: {
        input: IsFileDiffRequest,
        success: IsFileDiffResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    saveFile: {
        input: IsSaveFileRequest,
        success: IsSaveFileResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    discardFile: {
        input: IsDiscardFileRequest,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    fileTree: {
        input: IsWorkspaceIdRequest,
        success: IsFileTreeResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
})

export const RelayCodeApi = httpSchema(RelayCodeApiContract)
    .pathPrefix("api/code")
    .use(GG_RELAY_TOKEN)
    .routes({
        changedFiles: GGRpc.POST("changed-files"),
        commits: GGRpc.POST("commits"),
        fileDiff: GGRpc.POST("file-diff"),
        saveFile: GGRpc.POST("save-file"),
        discardFile: GGRpc.POST("discard-file"),
        fileTree: GGRpc.POST("file-tree"),
    })
