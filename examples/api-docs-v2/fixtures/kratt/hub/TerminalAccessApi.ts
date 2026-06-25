import {GGContractClass, IsObject, IsString, IsLiteral, SERVER_ERROR } from "@grest-ts/schema"
import {GGRpc, GGHttpSchema} from "@grest-ts/http"
import {UNAUTHORIZED, NOT_FOUND} from "./errors"
import {GG_USER_TOKEN, GG_ORG_TOKEN} from "../auth/AuthContext"
import {IsTaskId, IsServiceName} from "./schemas"

const IsGetAccessTokenRequest = IsObject({
    taskId: IsTaskId,
    /** When set, the relay attaches to this tmux session name instead of the task's session. Used for agent terminals. */
    tmuxSession: IsString.orUndefined,
    type: IsLiteral("terminal", "shell", "logs", "relay-logs", "lsp", "code-server"),
    serviceName: IsServiceName.orUndefined,
})

const IsGetAccessTokenResponse = IsObject({
    token: IsString,
    relayUrl: IsString,
})

export const TerminalAccessApiContract = new GGContractClass("TerminalAccessApi", {
    getAccessToken: {
        input: IsGetAccessTokenRequest,
        success: IsGetAccessTokenResponse,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
})

export const TerminalAccessApi = new GGHttpSchema({
    contract: TerminalAccessApiContract,
    pathPrefix: "api",
    use: [GG_USER_TOKEN, GG_ORG_TOKEN],
    routes: {
        getAccessToken: GGRpc.POST("terminal/access-token"),
    },
})
