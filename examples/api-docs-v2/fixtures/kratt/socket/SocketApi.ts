import {GGWebSocketSchema} from "@grest-ts/websocket"
import {IsObject, IsString, NOT_AUTHORIZED, SERVER_ERROR, GGDuplexContract } from "@grest-ts/schema"
import {UNAUTHORIZED, NOT_FOUND} from "../hub/errors"
import {GG_USER_TOKEN, GG_ORG_TOKEN} from "../auth/AuthContext"
import {
    IsTaskEvent, IsAgentEvent, IsServiceEvent,
    IsBaseImageEvent, IsProjectImageEvent,
    IsTaskOverviewEvent,
} from "./events"

const IsTopicRequest = IsObject({topic: IsString})

/**
 * Browser ↔ socket-server contract.
 *
 *   clientToServer: control only (subscribe / unsubscribe).
 *     No domain data ever flows this direction — all commands stay on HTTP.
 *   serverToClient: data events, one method per entity type.
 *     Same schemas as NotifyApi — types flow straight through.
 *
 * The socket-server routes an incoming notify to the correct serverToClient
 * method based on the topic prefix (see Topics / parseTopic).
 */
export const SocketContract = new GGDuplexContract("KrattSocket", {
    connect: { errors: [NOT_AUTHORIZED, SERVER_ERROR] },
    clientToServer: {
        subscribe:   {input: IsTopicRequest, errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
        },
        unsubscribe: {input: IsTopicRequest, errors: [SERVER_ERROR],
        },
    },
    serverToClient: {
        onTask:         {input: IsTaskEvent,
        },
        onAgent:        {input: IsAgentEvent,
        },
        onService:      {input: IsServiceEvent,
        },
        onBaseImage:    {input: IsBaseImageEvent,
        },
        onProjectImage: {input: IsProjectImageEvent,
        },
        onTaskOverview: {input: IsTaskOverviewEvent,
        },
    },
})

export const SocketApi = new GGWebSocketSchema({
    contract: SocketContract,
    path: "/socket",
    use: [GG_USER_TOKEN, GG_ORG_TOKEN],
})
