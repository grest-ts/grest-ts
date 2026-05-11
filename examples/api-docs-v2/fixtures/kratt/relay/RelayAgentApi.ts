import {GGContractClass, IsObject, IsString, IsNumber, IsLiteral, IsArray, SERVER_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema"
import {GGRpc, httpSchema} from "@grest-ts/http"
import {GG_RELAY_TOKEN} from "./RelayAuthContext.js"
import {IsAgentId} from "../hub/schemas.js"

/**
 * Relay-side API for managing Claude CLI agent tmux sessions inside the VM.
 *
 * Replaces the old `kratt-agent` python script that hub-server invoked over
 * SSH. The relay daemon now owns `/var/lib/kratt-relay/agents.json` and runs
 * a background activity-detection loop, so hub-server's AgentApiImpl is a
 * thin pass-through to these endpoints.
 *
 * Privilege model: relay runs as `kratt-system` and shells out to `sudo -u
 * kratt /usr/bin/tmux …` to manipulate sessions owned by the `kratt` user.
 * The sudoers entry in recipe.sh's `91-kratt-system` allows exactly that.
 */

export const IsAgentRecord = IsObject({
    agentId: IsAgentId,
    name: IsString,
    workdir: IsString,
    tmuxSession: IsString,
    claudeSessionId: IsString.orUndefined,
    claudeJsonlPath: IsString.orUndefined,
    status: IsLiteral("running", "suspended", "stopped", "deleted"),
    activity: IsLiteral("working", "idle", "no-session").orUndefined,
    secondsSinceActivity: IsNumber.orUndefined,
    createdAt: IsNumber,
})

export type AgentRecord = typeof IsAgentRecord.infer

const IsLaunchInput = IsObject({
    name: IsString,
    workdir: IsString,
    resume: IsString.orUndefined,
})

const IsAgentIdInput = IsObject({agentId: IsAgentId})

const IsListResponse = IsObject({agents: IsArray(IsAgentRecord)})
const IsAgentResponse = IsObject({agent: IsAgentRecord})
const IsSuspendResponse = IsObject({suspended: IsArray(IsAgentId)})

export const RelayAgentApiContract = new GGContractClass("RelayAgentApi", {
    /** List agents with live status (lifecycle) and activity (working/idle/no-session). */
    list: {
        success: IsListResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    /** Launch a new agent in a fresh tmux session. */
    launch: {
        input: IsLaunchInput,
        success: IsAgentResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    /** Stop an agent's tmux session (kills claude). Registry entry stays. */
    stop: {
        input: IsAgentIdInput,
        success: IsAgentResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    /** Relaunch a stopped/suspended agent, with `claude --resume` if a session-id is known. */
    resume: {
        input: IsAgentIdInput,
        success: IsAgentResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    /**
     * Soft-delete: kill tmux + mark status="deleted", keep the entry so the
     * claude session-id is preserved and the agent can be Restored later
     * (a normal `resume` call). Agents that never had a session-id are hard-
     * deleted in the same call (no substance to preserve).
     */
    delete: {
        input: IsAgentIdInput,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    /**
     * Hard-delete a soft-deleted agent. Drops the registry entry AND removes
     * the underlying claude .jsonl transcript file. Use to clean up old
     * sessions you don't want hanging around.
     */
    purge: {
        input: IsAgentIdInput,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    /** Mark every running agent as suspended (called pre-VM-stop). */
    suspendAll: {
        success: IsSuspendResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
})

export const RelayAgentApi = httpSchema(RelayAgentApiContract)
    .pathPrefix("api/agents")
    .use(GG_RELAY_TOKEN)
    .routes({
        list: GGRpc.GET("list"),
        launch: GGRpc.POST("launch"),
        stop: GGRpc.POST("stop"),
        resume: GGRpc.POST("resume"),
        delete: GGRpc.POST("delete"),
        purge: GGRpc.POST("purge"),
        suspendAll: GGRpc.POST("suspend-all"),
    })
