import {GGContractClass, IsObject, IsString, IsNumber, IsLiteral, IsArray, SERVER_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema"
import {GGRpc, httpSchema} from "@grest-ts/http"
import {UNAUTHORIZED, NOT_FOUND} from "./errors"
import {GG_USER_TOKEN, GG_ORG_TOKEN} from "../auth/AuthContext"
import {IsProjectImageId, IsProjectId, IsBaseImageId, IsTaskId} from "./schemas"

/**
 * ProjectImage — snapshot of a project task VM. Org-scoped + project-scoped.
 * Created exclusively via task.snapshotAsImage, never via a standalone
 * build endpoint. Always derives from a BaseImage (baseImageId).
 */
export const IsProjectImage = IsObject({
    projectImageId: IsProjectImageId,
    projectId: IsProjectId,
    name: IsString,
    provider: IsLiteral("multipass", "hetzner"),
    providerImageId: IsString.orUndefined,
    baseImageId: IsBaseImageId,
    status: IsLiteral("building", "ready", "failed", "missing"),
    /** "project" — clean, scrubbed snapshot usable as a template for
     *  spawning new tasks. Created by `task.snapshotAsImage`.
     *  "task-clone" — dirty full-state copy of a specific task, used only
     *  to resume THAT task after archive. Created by `task.archive`. Not
     *  shown as a spawnable image in the UI. */
    kind: IsLiteral("project", "task-clone").orUndefined,
    /** Set when kind === "task-clone": the task this clone belongs to. */
    taskId: IsTaskId.orUndefined,
    buildProgress: IsString.orUndefined,
    buildProgressTotal: IsNumber.orUndefined,
    buildProgressCompleted: IsNumber.orUndefined,
    buildProgressStartedAt: IsNumber.orUndefined,
    builtAt: IsNumber.orUndefined,
    error: IsString.orUndefined,
    /** Monotonic per-entity version, bumped on every write. Legacy records
     *  predating this field read as 0 and bump to 1 on next put. */
    version: IsNumber,
})

export type ProjectImage = typeof IsProjectImage.infer

const IsProjectImageIdRequest = IsObject({
    projectImageId: IsProjectImageId,
})

const IsListProjectImagesRequest = IsObject({
    projectId: IsProjectId.orUndefined,
})

export const ProjectImageApiContract = new GGContractClass("ProjectImageApi", {
    list: {
        input: IsListProjectImagesRequest,
        success: IsArray(IsProjectImage),
        errors: [UNAUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    get: {
        input: IsProjectImageIdRequest,
        success: IsProjectImage,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    delete: {
        input: IsProjectImageIdRequest,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
})

export const ProjectImageApi = httpSchema(ProjectImageApiContract)
    .pathPrefix("api")
    .use(GG_USER_TOKEN)
    .use(GG_ORG_TOKEN)
    .routes({
        list: GGRpc.POST("project-images/list"),
        get: GGRpc.POST("project-images/get"),
        delete: GGRpc.POST("project-images/delete"),
    })
