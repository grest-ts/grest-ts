import {IsObject, IsString, IsBoolean, IsLiteral, IsArray, IsNumber} from "@grest-ts/schema"

// ─── Branded ID types ───────────────────────────────────────────────────
// Nominal types over plain strings. Catch arg-order mistakes at compile
// time — Topics.task(orgId, taskId) rejects Topics.task(taskId, orgId),
// notify.notifyTask({orgId, taskId: agentId}) rejects, etc.
//
// Cast at the source (DDB read, randomUUID()) — every value flowing
// through typed schemas inherits the brand. Casting is one-time at
// boundaries; everywhere else the brand propagates for free.

export const IsOrgId          = IsString.brand("OrgId")
export const IsUserId         = IsString.brand("UserId")
export const IsOrgUserId      = IsString.brand("OrgUserId")
export const IsTaskId         = IsString.brand("TaskId")
export const IsAgentId        = IsString.brand("AgentId")
export const IsProjectId      = IsString.brand("ProjectId")
export const IsBaseImageId    = IsString.brand("BaseImageId")
export const IsProjectImageId = IsString.brand("ProjectImageId")
export const IsServiceName    = IsString.brand("ServiceName")

export type tOrgId          = typeof IsOrgId.infer
export type tUserId         = typeof IsUserId.infer
export type tOrgUserId      = typeof IsOrgUserId.infer
export type tTaskId         = typeof IsTaskId.infer
export type tAgentId        = typeof IsAgentId.infer
export type tProjectId      = typeof IsProjectId.infer
export type tBaseImageId    = typeof IsBaseImageId.infer
export type tProjectImageId = typeof IsProjectImageId.infer
export type tServiceName    = typeof IsServiceName.infer

/**
 * Ciphertext brand. Anything passed through `TokenService.encryptString`
 * comes out as `tEncrypted`; `decryptString` only accepts `tEncrypted`.
 * This catches "passed plaintext to a field that should hold ciphertext"
 * bugs at compile time — e.g. accidentally storing a raw API key in
 * `hetznerApiKey` without going through the encrypt step.
 */
export const IsEncrypted = IsString.brand("Encrypted")
export type tEncrypted = typeof IsEncrypted.infer

export const IsUser = IsObject({
    userId: IsUserId,
    username: IsString,
    root: IsBoolean.orUndefined,
})

export type User = typeof IsUser.infer

export const IsOrganization = IsObject({
    orgId: IsOrgId,
    name: IsString,
    hasHetznerCredentials: IsBoolean,
    githubInstallations: IsArray(IsObject({id: IsNumber, account: IsString})).orUndefined,
})

export type Organization = typeof IsOrganization.infer

export const IsProjectRepo = IsObject({
    gitUrl: IsString,
    name: IsString,
    hasKey: IsBoolean,
    installationId: IsNumber.orUndefined,
})

export type ProjectRepo = typeof IsProjectRepo.infer

export const IsAgent = IsObject({
    agentId: IsAgentId,
    taskId: IsTaskId,
    name: IsString,
    workdir: IsString,
    tmuxSession: IsString,
    claudeSessionId: IsString.orUndefined,
    claudeJsonlPath: IsString.orUndefined,
    status: IsLiteral("starting", "running", "suspended", "stopped", "failed", "deleted"),
    activity: IsLiteral("working", "idle", "no-session").orUndefined,
    secondsSinceActivity: IsNumber.orUndefined,
    createdAt: IsNumber,
})

export type Agent = typeof IsAgent.infer

export const IsOrgUser = IsObject({
    orgUserId: IsOrgUserId,
    orgId: IsOrgId,
    userId: IsUserId,
    username: IsString,
    permissions: IsString,
})

export type OrgUser = typeof IsOrgUser.infer

export const IsLayoutSlot = IsObject({
    id: IsString,
    x: IsNumber,
    y: IsNumber,
    w: IsNumber,
    h: IsNumber,
})

export const IsLayoutProfile = IsObject({
    name: IsString,
    slots: IsArray(IsLayoutSlot),
})

export type LayoutProfile = typeof IsLayoutProfile.infer

/**
 * Layouts seeded on project creation. Lives in hub-api so backend seed and
 * frontend UI reference the same list.
 */
export const DEFAULT_LAYOUT_PROFILES: LayoutProfile[] = [
    {name: "Single", slots: [
        {id: "full", x: 0, y: 0, w: 1, h: 1},
    ]},
    {name: "2 Columns", slots: [
        {id: "left", x: 0, y: 0, w: 0.5, h: 1},
        {id: "right", x: 0.5, y: 0, w: 0.5, h: 1},
    ]},
    {name: "3 Columns", slots: [
        {id: "left", x: 0, y: 0, w: 0.333, h: 1},
        {id: "center", x: 0.333, y: 0, w: 0.334, h: 1},
        {id: "right", x: 0.667, y: 0, w: 0.333, h: 1},
    ]},
    {name: "2 Rows", slots: [
        {id: "top", x: 0, y: 0, w: 1, h: 0.5},
        {id: "bottom", x: 0, y: 0.5, w: 1, h: 0.5},
    ]},
    {name: "1 + 2", slots: [
        {id: "main", x: 0, y: 0, w: 0.6, h: 1},
        {id: "top-right", x: 0.6, y: 0, w: 0.4, h: 0.5},
        {id: "bottom-right", x: 0.6, y: 0.5, w: 0.4, h: 0.5},
    ]},
    {name: "2 + 1", slots: [
        {id: "top-left", x: 0, y: 0, w: 0.4, h: 0.5},
        {id: "bottom-left", x: 0, y: 0.5, w: 0.4, h: 0.5},
        {id: "main", x: 0.4, y: 0, w: 0.6, h: 1},
    ]},
    {name: "2x2 Grid", slots: [
        {id: "tl", x: 0, y: 0, w: 0.5, h: 0.5},
        {id: "tr", x: 0.5, y: 0, w: 0.5, h: 0.5},
        {id: "bl", x: 0, y: 0.5, w: 0.5, h: 0.5},
        {id: "br", x: 0.5, y: 0.5, w: 0.5, h: 0.5},
    ]},
]

export const IsProject = IsObject({
    projectId: IsProjectId,
    name: IsString,
    repos: IsArray(IsProjectRepo),
    /** Latest ready project image for this project. Work tasks default to
     *  spawning from this image; null/undefined means the project has never
     *  been snapshotted yet (first run must be a setup task). */
    currentProjectImageId: IsProjectImageId.orUndefined,
    setupCommands: IsArray(IsString).orUndefined,
    /** Custom layout profiles for the desktop view. */
    layouts: IsArray(IsLayoutProfile).orUndefined,
    /** Name of the last-used layout profile (default for new tasks). */
    defaultLayoutName: IsString.orUndefined,
})

export type Project = typeof IsProject.infer

/**
 * Compact task summary for the overview channel (`org:{O}:tasks`).
 *
 * Carries exactly what the task list UI needs — never full state, never
 * agent detail. `hasActiveAgent` is the one denormalized field; the work
 * server maintains it when agents write so the overview channel never has
 * to read siblings.
 *
 * Detailed task status ("half-idle", "fully active", etc.) is derived
 * client-side in the task detail view from the actual agent entities.
 */
export const IsTaskSummary = IsObject({
    taskId: IsTaskId,
    orgId: IsOrgId,
    projectId: IsProjectId,
    name: IsString,
    status: IsLiteral("spawning", "running", "idle", "resuming", "snapshotting", "stopped", "archived", "failed"),
    hasActiveAgent: IsBoolean,
    lastActiveAt: IsNumber,
    createdAt: IsNumber,
})

export type TaskSummary = typeof IsTaskSummary.infer
