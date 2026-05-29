import {defineSocketContract, webSocketSchema} from "@grest-ts/websocket"
import {cookie} from "@grest-ts/http"
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
// The SAME cookie key the HTTP CookieTestApi binds — one key, two transports.
import {SESSION} from "./CookieTestApi"

/**
 * Resolve connection scopes from the session cookie that rode in on the WS upgrade.
 * No session → null (no identity, so connectPermission rejects with NOT_AUTHORIZED).
 * A session value containing "admin" → [Admin, Read]; any other session → [Read].
 */
export const getScopesFromSession = (): ReadonlySet<string> | null => {
    const session = SESSION.get()
    if (!session) return null
    if (session.includes("admin")) return new Set([AppPermission.Admin, AppPermission.Read])
    return new Set([AppPermission.Read])
}

export const WsCookieApiContract = defineSocketContract("WsCookieApi", {
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
})

// .connectPermission(Read) is the "allowSocketConnection" gate: a connection with no
// session cookie resolves to no scopes and is rejected at the handshake.
export const WsCookieApi = webSocketSchema(WsCookieApiContract)
    .path("ws/cookie-test")
    .use(cookie(SESSION))
    .connectPermission(AppPermission.Read)
    .done()

export type WsCookieIncoming = GGContractImplementation<typeof WsCookieApiContract.methods["clientToServer"]>
export type WsCookieOutgoing = GGContractClient<typeof WsCookieApiContract.methods["serverToClient"]>
