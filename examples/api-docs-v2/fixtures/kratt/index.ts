// Errors
export {
    INVALID_CREDENTIALS, UNAUTHORIZED, NO_ACCESS, NOT_FOUND, ALREADY_EXISTS,
    AGENT_NOT_RUNNING, NAME_TAKEN,
} from "./hub/errors"

// Schemas
export {IsUser, IsOrganization, IsProjectRepo, IsAgent, IsOrgUser, IsProject, IsLayoutProfile, DEFAULT_LAYOUT_PROFILES, IsTaskSummary} from "./hub/schemas"
export type {User, Organization, ProjectRepo, Agent, OrgUser, Project, LayoutProfile, TaskSummary} from "./hub/schemas"

// Branded ID types
export {
    IsOrgId, IsUserId, IsOrgUserId, IsTaskId, IsAgentId, IsProjectId,
    IsBaseImageId, IsProjectImageId, IsServiceName, IsEncrypted,
} from "./hub/schemas"
export type {
    tOrgId, tUserId, tOrgUserId, tTaskId, tAgentId, tProjectId,
    tBaseImageId, tProjectImageId, tServiceName, tEncrypted,
} from "./hub/schemas"

// Auth
export {IsUserTokenPayload, IsOrgTokenPayload} from "./auth/AuthSchemas.js"
export type {UserTokenPayload, OrgTokenPayload} from "./auth/AuthSchemas.js"
export {GG_USER_TOKEN, GG_ORG_TOKEN} from "./auth/AuthContext.js"
export {AuthApiContract, AuthApi} from "./hub/AuthApi"

// User (admin)
export {UserApiContract, UserApi} from "./hub/UserApi"

// Organization (admin)
export {OrganizationApiContract, OrganizationApi} from "./hub/OrganizationApi"

// OrgUser
export {OrgUserApiContract, OrgUserApi} from "./hub/OrgUserApi"

// Agent
export {AgentApiContract, AgentApi} from "./hub/AgentApi"

// Terminal Access
export {TerminalAccessApiContract, TerminalAccessApi} from "./hub/TerminalAccessApi"

// Project
export {ProjectApiContract, ProjectApi} from "./hub/ProjectApi"

// Base images (Kratt-provided, root-only, global)
export {BaseImageApiContract, BaseImageApi, IsBaseImage} from "./hub/BaseImageApi"
export type {BaseImage} from "./hub/BaseImageApi"

// Project images (per-project snapshots of task VMs, dev-owned)
export {ProjectImageApiContract, ProjectImageApi, IsProjectImage} from "./hub/ProjectImageApi"
export type {ProjectImage} from "./hub/ProjectImageApi"

// Task (v2 — VM-per-task lifecycle)
export {TaskApiContract, TaskApi, IsTask, IsTaskService} from "./hub/TaskApi"
export type {Task, TaskService} from "./hub/TaskApi"

// Code Review
export {CodeReviewApiContract, CodeReviewApi} from "./hub/CodeReviewApi"

// Hosting resolve (internal — used by the hosting proxy)
export {HostingResolveApiContract, HostingResolveApi, GG_HOSTING_PROXY_SECRET} from "./hub/HostingResolveApi"

/**
 * Port relay's VM proxy listens on inside every task VM. Constant so that
 * hub-server can return it in resolve responses and the relay binds the
 * same value. If this ever needs to vary per task, promote it to
 * TaskRecord and keep it as the default.
 */
export const RELAY_VM_PROXY_PORT = 9601

// ─── Socket / Notify (formerly @kratt/socket-api) ──────────────────────

// Event payload schemas (shared between NotifyApi and SocketApi)
export {
    IsTaskEvent, IsAgentEvent, IsServiceEvent,
    IsBaseImageEvent, IsProjectImageEvent,
    IsTaskOverviewEvent,
} from "./socket/events"
export type {
    TaskEvent, AgentEvent, ServiceEvent,
    BaseImageEvent, ProjectImageEvent,
    TaskOverviewEvent,
} from "./socket/events"

// Topic helpers
export {Topics, parseTopic} from "./socket/topics"
export type {ParsedTopic} from "./socket/topics"

// Internal auth (shared-secret transport)
export {GG_INTERNAL_TOKEN} from "./auth/internalAuth"

// HTTP: work-server → socket-server push
export {NotifyApiContract, NotifyApi} from "./socket/NotifyApi"

// WebSocket: socket-server → browser events
export {SocketApi} from "./socket/SocketApi"

// ─── Relay (formerly @kratt/api) ─────────────────────────────────
// HTTP + WS contracts for the relay daemon that runs inside every task VM.
// hub-server uses these as a client; the relay package implements them.

export {IsServerAccessTokenPayload} from "./relay/ServerAccessToken"
export type {ServerAccessTokenPayload} from "./relay/ServerAccessToken"

export type {ClientMessage, ServerMessage} from "./relay/TerminalProtocol"

export {IsHealthResponse, HealthApiContract, HealthApi} from "./relay/HealthResponse"
export type {HealthResponse} from "./relay/HealthResponse"

export {IsServiceStatus} from "./relay/RelayTypes"
export type {ServiceStatus} from "./relay/RelayTypes"

export {RelayCodeApiContract, RelayCodeApi} from "./relay/RelayCodeApi"
export {RelayServicesApiContract, RelayServicesApi} from "./relay/RelayServicesApi"
export {RelayAgentApiContract, RelayAgentApi, IsAgentRecord} from "./relay/RelayAgentApi"
export type {AgentRecord} from "./relay/RelayAgentApi"
export {GG_RELAY_TOKEN} from "./relay/RelayAuthContext"
