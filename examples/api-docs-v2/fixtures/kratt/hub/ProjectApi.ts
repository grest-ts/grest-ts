import {GGContractClass, IsObject, IsString, IsArray, IsBoolean, IsNumber, SERVER_ERROR } from "@grest-ts/schema"
import {GGRpc, httpSchema} from "@grest-ts/http"
import {UNAUTHORIZED, NOT_FOUND, NAME_TAKEN} from "./errors"
import {IsProject, IsProjectRepo, IsLayoutProfile, IsProjectId, IsProjectImageId} from "./schemas"
import {GG_USER_TOKEN, GG_ORG_TOKEN} from "../auth/AuthContext"

const IsCreateProjectRequest = IsObject({
    name: IsString,
    repos: IsArray(IsProjectRepo),
})

const IsProjectIdRequest = IsObject({
    projectId: IsProjectId,
})

const IsUpdateProjectRequest = IsObject({
    projectId: IsProjectId,
    name: IsString.orUndefined,
    repos: IsArray(IsProjectRepo).orUndefined,
    currentProjectImageId: IsProjectImageId.orUndefined,
    setupCommands: IsArray(IsString).orUndefined,
    layouts: IsArray(IsLayoutProfile).orUndefined,
    defaultLayoutName: IsString.orUndefined,
})

const IsAddRepoRequest = IsObject({
    projectId: IsProjectId,
    gitUrl: IsString,
    deployKey: IsString.orUndefined,
    publicKey: IsString.orUndefined,
    installationId: IsNumber.orUndefined,
})

const IsRemoveRepoRequest = IsObject({
    projectId: IsProjectId,
    gitUrl: IsString,
})

const IsTestRepoConnectionRequest = IsObject({
    projectId: IsProjectId,
    gitUrl: IsString,
})

const IsTestConnectionResponse = IsObject({
    success: IsBoolean,
    message: IsString,
})

const IsKeyPairResponse = IsObject({
    publicKey: IsString,
    privateKey: IsString,
})

const IsGitHubInstallUrlResponse = IsObject({
    url: IsString,
})

const IsGitHubRepo = IsObject({
    name: IsString,
    fullName: IsString,
    cloneUrl: IsString,
    private: IsBoolean,
    installationId: IsNumber,
})

const IsGitHubListReposResponse = IsObject({
    repos: IsArray(IsGitHubRepo),
})

export const ProjectApiContract = new GGContractClass("ProjectApi", {
    create: {
        input: IsCreateProjectRequest,
        success: IsProject,
        errors: [UNAUTHORIZED, NOT_FOUND, NAME_TAKEN, SERVER_ERROR],
    },
    get: {
        input: IsProjectIdRequest,
        success: IsProject,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    list: {
        success: IsArray(IsProject),
        errors: [UNAUTHORIZED, SERVER_ERROR],
    },
    update: {
        input: IsUpdateProjectRequest,
        success: IsProject,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    delete: {
        input: IsProjectIdRequest,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    addRepo: {
        input: IsAddRepoRequest,
        success: IsProject,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    removeRepo: {
        input: IsRemoveRepoRequest,
        success: IsProject,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    testRepoConnection: {
        input: IsTestRepoConnectionRequest,
        success: IsTestConnectionResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    generateKeyPair: {
        success: IsKeyPairResponse,
        errors: [UNAUTHORIZED, SERVER_ERROR],
    },
    githubInstallUrl: {
        success: IsGitHubInstallUrlResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    githubListRepos: {
        success: IsGitHubListReposResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
})

export const ProjectApi = httpSchema(ProjectApiContract)
    .pathPrefix("api")
    .use(GG_USER_TOKEN)
    .use(GG_ORG_TOKEN)
    .routes({
        create: GGRpc.POST("projects"),
        get: GGRpc.POST("projects/get"),
        list: GGRpc.GET("projects"),
        update: GGRpc.POST("projects/update"),
        delete: GGRpc.POST("projects/delete"),
        addRepo: GGRpc.POST("projects/add-repo"),
        removeRepo: GGRpc.POST("projects/remove-repo"),
        testRepoConnection: GGRpc.POST("projects/test-repo-connection"),
        generateKeyPair: GGRpc.POST("projects/generate-key-pair"),
        githubInstallUrl: GGRpc.GET("github/install-url"),
        githubListRepos: GGRpc.GET("github/repos"),
    })
