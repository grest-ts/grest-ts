import {GGContractClass, SERVER_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema"
import {GGRpc, httpSchema} from "@grest-ts/http"
import {UNAUTHORIZED} from "../hub/errors"
import {GG_INTERNAL_TOKEN} from "../auth/internalAuth"
import {
    IsTaskEvent, IsAgentEvent, IsServiceEvent,
    IsBaseImageEvent, IsProjectImageEvent,
    IsTaskOverviewEvent,
} from "./events"

/**
 * Work-server → socket-server push channel. One endpoint per event type;
 * shares schemas with SocketApi's serverToClient methods, so types flow
 * end-to-end from DDB write to browser handler with zero duplication.
 *
 * Every endpoint is gated by GG_INTERNAL_TOKEN — it's a shared secret,
 * not user-facing auth.
 */
export const NotifyApiContract = new GGContractClass("NotifyApi", {
    notifyTask:         {input: IsTaskEvent,         errors: [UNAUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    notifyAgent:        {input: IsAgentEvent,        errors: [UNAUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    notifyService:      {input: IsServiceEvent,      errors: [UNAUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    notifyBaseImage:    {input: IsBaseImageEvent,    errors: [UNAUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    notifyProjectImage: {input: IsProjectImageEvent, errors: [UNAUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    notifyTaskOverview: {input: IsTaskOverviewEvent, errors: [UNAUTHORIZED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
})

export const NotifyApi = httpSchema(NotifyApiContract)
    .pathPrefix("internal/notify")
    .use(GG_INTERNAL_TOKEN)
    .routes({
        notifyTask:         GGRpc.POST("task"),
        notifyAgent:        GGRpc.POST("agent"),
        notifyService:      GGRpc.POST("service"),
        notifyBaseImage:    GGRpc.POST("base-image"),
        notifyProjectImage: GGRpc.POST("project-image"),
        notifyTaskOverview: GGRpc.POST("task-overview"),
    })
