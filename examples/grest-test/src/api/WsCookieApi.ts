import {webSocketSchema} from "@grest-ts/websocket"
import {GGContextKey} from "@grest-ts/context"
import {GGCookie} from "@grest-ts/http"
import {
    FORBIDDEN,
    GG_NO_PERMISSIONS,
    GGContractClient,
    GGContractImplementation,
    IsString,
    NOT_AUTHORIZED,
    SERVER_ERROR,
} from "@grest-ts/schema"
import {AppPermission} from "./PermissionsApi"

// WsCookieApi's own credential wire over the same "session" cookie. Unlike CookieTestApi's
// ambient SESSION, this one is required-or-throw: a missing cookie is unauthenticated, so
// process() rejects the handshake with 401 rather than resolving to no scopes.
export const WS_SESSION = new GGCookie("session")
export const WS_SESSION_VALUE = new GGContextKey<string | undefined>("ws-session-value", IsString.orUndefined)

export const WS_SESSION_HANDLER = WS_SESSION.define(() => ({
    process: async () => {
        const v = WS_SESSION.get()
        if (v === undefined) throw new NOT_AUTHORIZED({debugMessage: "no session cookie"})
        WS_SESSION_VALUE.set(v)
    },
    permissions: async () => {
        const s = WS_SESSION_VALUE.get()
        if (!s) return []
        return s.includes("admin") ? [AppPermission.Admin, AppPermission.Read] : [AppPermission.Read]
    },
}))

const WsCookieApiMethods = {
    clientToServer: {
        // Echoes the session value the upgrade cookie populated — proves the read path.
        whoami: {
            success: IsString.orUndefined,
            errors: [SERVER_ERROR],
            permission: GG_NO_PERMISSIONS,
        },
        // Per-message gate on a scope derived from the cookie session.
        adminOnly: {
            success: IsString,
            errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
            permission: AppPermission.Admin,
        },
    },
    serverToClient: {},
}

// WS_SESSION.process() throws NOT_AUTHORIZED on a missing cookie (401, unauthenticated);
// connectPermission(Read) then gates the authenticated connection's scopes.
export const WsCookieApi = webSocketSchema("WsCookieApi")
    .path("ws/cookie-test")
    .use(WS_SESSION)
    .connectPermission(AppPermission.Read)
    .messages(WsCookieApiMethods)

export type WsCookieIncoming = GGContractImplementation<typeof WsCookieApiMethods["clientToServer"]>
export type WsCookieOutgoing = GGContractClient<typeof WsCookieApiMethods["serverToClient"]>
