import {GGContractClass, IsObject, IsString, IsNumber, IsBoolean, IsArray, SERVER_ERROR} from "@grest-ts/schema"
import {GGRpc, httpSchema} from "@grest-ts/http"
import {UNAUTHORIZED, NOT_FOUND} from "./errors"
import {GG_USER_TOKEN, GG_ORG_TOKEN} from "../auth/AuthContext"
import {IsTaskId} from "./schemas"

const IsTaskIdRequest = IsObject({
    taskId: IsTaskId,
})

const IsChangedFilesRequest = IsObject({
    taskId: IsTaskId,
    diffBase: IsString.orUndefined,
    diffTarget: IsString.orUndefined,
})

const IsFileDiffRequest = IsObject({
    taskId: IsTaskId,
    repo: IsString,
    path: IsString,
    diffBase: IsString.orUndefined,
    diffTarget: IsString.orUndefined,
})

const IsSaveFileRequest = IsObject({
    taskId: IsTaskId,
    repo: IsString,
    path: IsString,
    content: IsString,
    expectedVersion: IsString,
})

const IsDiscardFileRequest = IsObject({
    taskId: IsTaskId,
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

export const CodeReviewApiContract = new GGContractClass("CodeReviewApi", {
    changedFiles: {
        input: IsChangedFilesRequest,
        success: IsChangedFilesResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    commits: {
        input: IsTaskIdRequest,
        success: IsCommitsResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    fileDiff: {
        input: IsFileDiffRequest,
        success: IsFileDiffResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    saveFile: {
        input: IsSaveFileRequest,
        success: IsSaveFileResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    discardFile: {
        input: IsDiscardFileRequest,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    fileTree: {
        input: IsTaskIdRequest,
        success: IsFileTreeResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
})

export const CodeReviewApi = httpSchema(CodeReviewApiContract)
    .pathPrefix("api")
    .use(GG_USER_TOKEN)
    .use(GG_ORG_TOKEN)
    .routes({
        changedFiles: GGRpc.POST("code-review/changed-files"),
        commits: GGRpc.POST("code-review/commits"),
        fileDiff: GGRpc.POST("code-review/file-diff"),
        saveFile: GGRpc.POST("code-review/save-file"),
        discardFile: GGRpc.POST("code-review/discard-file"),
        fileTree: GGRpc.POST("code-review/file-tree"),
    })
