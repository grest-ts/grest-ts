import {GGContractClass, IsObject, IsString, IsBoolean, IsArray, SERVER_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema"
import {GGRpc, httpSchema} from "@grest-ts/http"
import {GG_RELAY_TOKEN} from "./RelayAuthContext.js"
import {IsServiceStatus} from "./RelayTypes.js"

/**
 * Relay-side API for listing and controlling user services declared in
 * `.kratt.json`. The hub-server calls this on behalf of the UI: the UI
 * hits hub-server, hub-server forwards to the relay over the relay's
 * HTTP port using a short-lived bearer token.
 *
 * See KRATT_HOSTING.md "Task model" — services are systemd-managed
 * and independent of relay's own lifetime. This API is how hub learns
 * what's running.
 */

const IsListServicesResponse = IsObject({
    services: IsArray(IsServiceStatus),
})

const IsServiceNameRequest = IsObject({
    name: IsString,
})

export const RelayServicesApiContract = new GGContractClass("RelayServicesApi", {
    /** Return declared services + live systemd state (name, port, running). */
    list: {
        success: IsListServicesResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    /**
     * Re-read `.kratt.json` across all workspace repos and reconcile
     * systemd units to match. Adds new services, updates changed ones,
     * removes orphaned ones. Idempotent.
     */
    sync: {
        success: IsListServicesResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    /** Restart a single declared service. */
    restart: {
        input: IsServiceNameRequest,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    /** Stop a single declared service without disabling it. */
    stop: {
        input: IsServiceNameRequest,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    /** Toggle public/private mode for all services at once. */
    setPublic: {
        input: IsObject({public: IsBoolean}),
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
})

export const RelayServicesApi = httpSchema(RelayServicesApiContract)
    .pathPrefix("api/services")
    .use(GG_RELAY_TOKEN)
    .routes({
        list: GGRpc.GET("list"),
        sync: GGRpc.POST("sync"),
        restart: GGRpc.POST("restart"),
        stop: GGRpc.POST("stop"),
        setPublic: GGRpc.POST("set-public"),
    })
