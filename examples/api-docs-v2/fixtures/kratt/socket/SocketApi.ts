import {defineSocketContract, webSocketSchema} from "@grest-ts/websocket"
import {IsObject, IsString, SERVER_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema"
import {UNAUTHORIZED, NOT_FOUND} from "../hub/errors"
import {SocketAuthHeaderMiddleware} from "../auth/internalAuth"
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
export const SocketContract = defineSocketContract("KrattSocket", {
    clientToServer: {
        subscribe:   {input: IsTopicRequest, errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
            permission: GG_NO_PERMISSIONS
        },
        unsubscribe: {input: IsTopicRequest, errors: [SERVER_ERROR],
            permission: GG_NO_PERMISSIONS
        },
    },
    serverToClient: {
        onTask:         {input: IsTaskEvent,
            permission: GG_NO_PERMISSIONS
        },
        onAgent:        {input: IsAgentEvent,
            permission: GG_NO_PERMISSIONS
        },
        onService:      {input: IsServiceEvent,
            permission: GG_NO_PERMISSIONS
        },
        onBaseImage:    {input: IsBaseImageEvent,
            permission: GG_NO_PERMISSIONS
        },
        onProjectImage: {input: IsProjectImageEvent,
            permission: GG_NO_PERMISSIONS
        },
        onTaskOverview: {input: IsTaskOverviewEvent,
            permission: GG_NO_PERMISSIONS
        },
    },
})

export const SocketApi = webSocketSchema(SocketContract)
    .path("/socket")
    .use(new SocketAuthHeaderMiddleware())
    .done()
