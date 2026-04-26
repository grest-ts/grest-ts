import {GGContractClass, IsObject, IsString, IsArray, SERVER_ERROR} from "@grest-ts/schema"
import {GGRpc, httpSchema} from "@grest-ts/http"
import {UNAUTHORIZED, NOT_FOUND} from "./errors"
import {IsAgent, IsTaskId, IsAgentId} from "./schemas"
import {GG_USER_TOKEN, GG_ORG_TOKEN} from "../auth/AuthContext"

const IsLaunchAgentRequest = IsObject({
    taskId: IsTaskId,
    name: IsString,
    workdir: IsString,
})

const IsAgentIdRequest = IsObject({
    taskId: IsTaskId,
    agentId: IsAgentId,
})

const IsListAgentsRequest = IsObject({
    taskId: IsTaskId,
})

export const AgentApiContract = new GGContractClass("AgentApi", {
    launch: {
        input: IsLaunchAgentRequest,
        success: IsAgent,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    list: {
        input: IsListAgentsRequest,
        success: IsArray(IsAgent),
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    stop: {
        input: IsAgentIdRequest,
        success: IsAgent,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    resume: {
        input: IsAgentIdRequest,
        success: IsAgent,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    /** Soft-delete: agent moves to status="deleted" but registry entry stays
     *  so it can be Restored (via `resume`) later. Agents with no session
     *  are hard-deleted in the same call. */
    delete: {
        input: IsAgentIdRequest,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    /** Hard-delete a soft-deleted agent: drops the registry entry AND removes
     *  the underlying claude .jsonl transcript. */
    purge: {
        input: IsAgentIdRequest,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
})

export const AgentApi = httpSchema(AgentApiContract)
    .pathPrefix("api")
    .use(GG_USER_TOKEN)
    .use(GG_ORG_TOKEN)
    .routes({
        launch: GGRpc.POST("agents/launch"),
        list: GGRpc.POST("agents/list"),
        stop: GGRpc.POST("agents/stop"),
        resume: GGRpc.POST("agents/resume"),
        delete: GGRpc.POST("agents/delete"),
        purge: GGRpc.POST("agents/purge"),
    })
