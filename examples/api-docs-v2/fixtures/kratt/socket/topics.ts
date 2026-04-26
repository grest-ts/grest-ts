import type {
    tOrgId, tTaskId, tAgentId,
    tBaseImageId, tProjectImageId,
    tServiceName,
} from "../hub/schemas"

/**
 * Canonical topic builders. Branded ID args — TypeScript catches arg-order
 * swaps and wrong-type IDs at compile time:
 *
 *   Topics.task(orgId, agentId)         // ❌ agentId is not tTaskId
 *   Topics.task(taskId, orgId)          // ❌ argument types swapped
 *   Topics.task("o-abc", "t-xyz")       // ❌ raw strings need brand cast
 *
 * Most call sites get branded values for free because the entity schemas
 * themselves use branded ID types. Only DDB scan results / random-UUID-
 * generated IDs need an explicit `as tTaskId` at the source boundary.
 *
 * All topics except `baseImage` are org-scoped — the socket-server checks
 * "is this client a member of org O?" before allowing any subscribe to
 * `org:{O}:*`. Base images are global / root-only (separate auth check).
 */

export const Topics = {
    task:         (orgId: tOrgId, taskId: tTaskId)            => `org:${orgId}:task:${taskId}`,
    agent:        (orgId: tOrgId, agentId: tAgentId)          => `org:${orgId}:agent:${agentId}`,
    service:      (orgId: tOrgId, taskId: tTaskId, serviceName: tServiceName) => `org:${orgId}:service:${taskId}:${serviceName}`,
    /** Base images are global (not org-scoped) — root-only resource. */
    baseImage:    (baseImageId: tBaseImageId)                 => `global:baseImage:${baseImageId}`,
    projectImage: (orgId: tOrgId, projectImageId: tProjectImageId) => `org:${orgId}:projectImage:${projectImageId}`,
    tasksOverview:(orgId: tOrgId)                             => `org:${orgId}:tasks`,
} as const

/**
 * Parse a topic into its components. Returns null if the topic is not
 * well-formed (wrong prefix, wrong number of segments). Used by the
 * socket-server to route incoming subscribe requests to the right PubSub
 * channel and to enforce org-scope auth.
 *
 * The branded fields below are exposed as plain strings — `parseTopic`
 * is the boundary where unstructured wire data crosses into typed land,
 * and the consumer (SocketApiHandler) only needs them for org-membership
 * checks, not for re-construction. If we ever want to feed parsed IDs
 * into Topics.x() round-trip, brand-cast at that call site.
 */
export function parseTopic(topic: string): ParsedTopic | null {
    const parts = topic.split(":")

    // Global (non-org-scoped) topics — base images are global/root-only.
    if (parts[0] === "global") {
        if (parts[1] === "baseImage" && parts.length === 3) {
            return {kind: "baseImage", baseImageId: parts[2]}
        }
        return null
    }

    if (parts.length < 3 || parts[0] !== "org") return null
    const orgId = parts[1]
    const kind = parts[2]

    if (kind === "task" && parts.length === 4) {
        return {kind: "task", orgId, taskId: parts[3]}
    }
    if (kind === "agent" && parts.length === 4) {
        return {kind: "agent", orgId, agentId: parts[3]}
    }
    if (kind === "service" && parts.length === 5) {
        return {kind: "service", orgId, taskId: parts[3], serviceName: parts[4]}
    }
    if (kind === "projectImage" && parts.length === 4) {
        return {kind: "projectImage", orgId, projectImageId: parts[3]}
    }
    if (kind === "tasks" && parts.length === 3) {
        return {kind: "tasksOverview", orgId}
    }
    return null
}

export type ParsedTopic =
    | {kind: "task", orgId: string, taskId: string}
    | {kind: "agent", orgId: string, agentId: string}
    | {kind: "service", orgId: string, taskId: string, serviceName: string}
    | {kind: "baseImage", baseImageId: string}
    | {kind: "projectImage", orgId: string, projectImageId: string}
    | {kind: "tasksOverview", orgId: string}
