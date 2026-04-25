import {GGContractClass, IsObject, IsString, IsNumber, IsBoolean, IsLiteral, IsArray, SERVER_ERROR} from "@grest-ts/schema"
import {GGRpc, httpSchema} from "@grest-ts/http"
import {UNAUTHORIZED, NOT_FOUND, NAME_TAKEN, AGENT_NOT_RUNNING} from "./errors"
import {GG_USER_TOKEN, GG_ORG_TOKEN} from "../auth/AuthContext"
import {IsTaskId, IsProjectId, IsProjectImageId, IsBaseImageId, IsServiceName} from "./schemas"

export const IsTask = IsObject({
    taskId: IsTaskId,
    projectId: IsProjectId,
    name: IsString,
    /** "work" — normal task spawned from a project image. "setup" — bootstrap
     *  task spawned from the base image; runs project prep at spawn time;
     *  used to build/refresh the project image via Make Image. */
    kind: IsLiteral("work", "setup"),
    status: IsLiteral("spawning", "running", "idle", "resuming", "snapshotting", "stopped", "archived", "failed"),
    provider: IsLiteral("multipass", "hetzner"),
    providerServerId: IsString.orUndefined,
    /** Public IPv4. Undefined on Multipass (host-only network) and on
     *  Hetzner deployments that disable public IPv4. */
    ip: IsString.orUndefined,
    /** Private-network IP. Always set post-spawn on Hetzner (vSwitch
     *  address) and Multipass (host-only address). */
    privateIp: IsString.orUndefined,
    /** Set for work tasks — the project image this task was spawned from. */
    projectImageId: IsProjectImageId.orUndefined,
    /** Set for setup tasks — the base image this task was spawned from. */
    baseImageId: IsBaseImageId.orUndefined,
    setupProgress: IsString.orUndefined,
    setupProgressTotal: IsNumber.orUndefined,
    setupProgressCompleted: IsNumber.orUndefined,
    setupProgressStartedAt: IsNumber.orUndefined,
    error: IsString.orUndefined,
    idleSeconds: IsNumber.orUndefined,
    idleCheckedAt: IsNumber.orUndefined,
    /** Set only while status === "snapshotting". The projectImageId of the
     *  in-flight ProjectImageRecord — UI uses it to render that image's
     *  build-progress bar as an overlay on the task view. */
    snapshotImageId: IsProjectImageId.orUndefined,
    /** Set while status === "archived". Points at the "task-clone" image
     *  that captures the task's full state; resume recreates a VM from
     *  this image and deletes it after the task is back up. */
    archivedImageId: IsProjectImageId.orUndefined,
    spawnStartedAt: IsNumber.orUndefined,
    createdAt: IsNumber,
    lastActiveAt: IsNumber,
})

export type Task = typeof IsTask.infer

const IsSpawnTaskRequest = IsObject({
    projectId: IsProjectId,
    name: IsString,
    /** "work" (default) — spawn from a project image. "setup" — spawn from
     *  a base image chosen by the caller and run project prep (clone repos,
     *  npm install, docker compose pull, setupCommands) at spawn time. */
    kind: IsLiteral("work", "setup").orUndefined,
    /** Work tasks: specific project image to clone from. Defaults to
     *  project.currentProjectImageId. Ignored for setup tasks. */
    projectImageId: IsProjectImageId.orUndefined,
    /** Setup tasks: which base image to spawn from. Required when kind=setup.
     *  Ignored for work tasks. */
    baseImageId: IsBaseImageId.orUndefined,
})

const IsSnapshotAsImageRequest = IsObject({
    taskId: IsTaskId,
    /** Display name for the new image. */
    name: IsString,
    /** If true, the new image becomes Project.currentProjectImageId after the snapshot
     *  succeeds. If false, the image is created but not promoted. */
    makeDefaultForProject: IsBoolean,
})

const IsSnapshotAsImageResponse = IsObject({
    imageId: IsProjectImageId,
})

const IsTaskIdRequest = IsObject({
    taskId: IsTaskId,
})

const IsRenameTaskRequest = IsObject({
    taskId: IsTaskId,
    name: IsString,
})

const IsTaskResponse = IsObject({task: IsTask})

const IsSyncCredentialsResponse = IsObject({
    credentialsSynced: IsBoolean,
    configSynced: IsBoolean,
})

/** Per-task outcome of a reconcile pass. See TaskApiImpl.reconcile. */
const IsReconcileTaskResult = IsObject({
    taskId: IsTaskId,
    name: IsString,
    /** "ok" — VM found and relay alive, IP unchanged, idle metrics reset.
     *  "ip-updated" — VM found and relay alive at a new IP (we've updated the DB).
     *  "unreachable" — VM exists in provider but relay /api/health not responding.
     *  "vm-missing" — task claims to be running but the VM is gone.
     *  "skipped" — task status doesn't warrant a check (stopped/failed). */
    action: IsLiteral("ok", "ip-updated", "unreachable", "vm-missing", "skipped"),
    oldIp: IsString.orUndefined,
    newIp: IsString.orUndefined,
    note: IsString.orUndefined,
})
/** Per-image outcome of a reconcile pass. Covers both base and project images. */
const IsReconcileImageResult = IsObject({
    imageId: IsString,
    name: IsString,
    kind: IsLiteral("base", "project"),
    /** "ok" — snapshot still exists in the provider.
     *  "now-missing" — snapshot vanished (deleted outside kratt); we flipped status → missing.
     *  "still-missing" — already marked missing and still is.
     *  "recovered" — DB said missing but the snapshot is back; flipped status → ready.
     *  "skipped" — image is in building/failed state, nothing to check. */
    action: IsLiteral("ok", "now-missing", "still-missing", "recovered", "skipped"),
    note: IsString.orUndefined,
})
const IsReconcileResponse = IsObject({
    tasks: IsArray(IsReconcileTaskResult),
    images: IsArray(IsReconcileImageResult),
})

/**
 * A single service as seen by hub — declared in .kratt.json and
 * reflected from systemd's live state inside the task VM. The `url`
 * field is pre-built by hub-server using the hosting URL template
 * (see HubConfig.hostingUrlTemplate) so the UI never needs to know
 * the template shape.
 */
export const IsTaskService = IsObject({
    name: IsServiceName,
    port: IsNumber,
    running: IsBoolean,
    exposed: IsBoolean,
    /** Public URL the "Open" button should navigate to. */
    url: IsString,
})

const IsListServicesResponse = IsObject({
    services: IsArray(IsTaskService),
})

const IsServiceActionRequest = IsObject({
    taskId: IsTaskId,
    name: IsServiceName,
})

export type TaskService = typeof IsTaskService.infer

export const TaskApiContract = new GGContractClass("TaskApi", {
    list: {
        success: IsArray(IsTask),
        errors: [UNAUTHORIZED, SERVER_ERROR],
    },
    get: {
        input: IsTaskIdRequest,
        success: IsTask,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    spawn: {
        input: IsSpawnTaskRequest,
        success: IsTaskResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, NAME_TAKEN, SERVER_ERROR],
    },
    resume: {
        input: IsTaskIdRequest,
        success: IsTaskResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    retrySpawn: {
        input: IsTaskIdRequest,
        success: IsTaskResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    stop: {
        input: IsTaskIdRequest,
        success: IsTaskResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    archive: {
        input: IsTaskIdRequest,
        success: IsTaskResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    delete: {
        input: IsTaskIdRequest,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    rename: {
        input: IsRenameTaskRequest,
        success: IsTaskResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, NAME_TAKEN, SERVER_ERROR],
    },
    syncCredentials: {
        input: IsTaskIdRequest,
        success: IsSyncCredentialsResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    snapshotAsImage: {
        input: IsSnapshotAsImageRequest,
        success: IsSnapshotAsImageResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    reconcile: {
        success: IsReconcileResponse,
        errors: [UNAUTHORIZED, SERVER_ERROR],
    },
    listServices: {
        input: IsTaskIdRequest,
        success: IsListServicesResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, AGENT_NOT_RUNNING, SERVER_ERROR],
    },
    syncServices: {
        input: IsTaskIdRequest,
        success: IsListServicesResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, AGENT_NOT_RUNNING, SERVER_ERROR],
    },
    restartService: {
        input: IsServiceActionRequest,
        errors: [UNAUTHORIZED, NOT_FOUND, AGENT_NOT_RUNNING, SERVER_ERROR],
    },
    stopService: {
        input: IsServiceActionRequest,
        errors: [UNAUTHORIZED, NOT_FOUND, AGENT_NOT_RUNNING, SERVER_ERROR],
    },
    setServicesPublic: {
        input: IsObject({taskId: IsTaskId, public: IsBoolean}),
        errors: [UNAUTHORIZED, NOT_FOUND, AGENT_NOT_RUNNING, SERVER_ERROR],
    },
})

export const TaskApi = httpSchema(TaskApiContract)
    .pathPrefix("api")
    .use(GG_USER_TOKEN)
    .use(GG_ORG_TOKEN)
    .routes({
        list: GGRpc.GET("tasks"),
        get: GGRpc.POST("tasks/get"),
        spawn: GGRpc.POST("tasks/spawn"),
        resume: GGRpc.POST("tasks/resume"),
        retrySpawn: GGRpc.POST("tasks/retry-spawn"),
        stop: GGRpc.POST("tasks/stop"),
        archive: GGRpc.POST("tasks/archive"),
        delete: GGRpc.POST("tasks/delete"),
        rename: GGRpc.POST("tasks/rename"),
        syncCredentials: GGRpc.POST("tasks/sync-credentials"),
        snapshotAsImage: GGRpc.POST("tasks/snapshot-as-image"),
        reconcile: GGRpc.POST("tasks/reconcile"),
        listServices: GGRpc.POST("tasks/list-services"),
        syncServices: GGRpc.POST("tasks/sync-services"),
        restartService: GGRpc.POST("tasks/restart-service"),
        stopService: GGRpc.POST("tasks/stop-service"),
        setServicesPublic: GGRpc.POST("tasks/set-services-public"),
    })
