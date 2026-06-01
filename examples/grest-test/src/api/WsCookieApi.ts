import {defineSocketContract, webSocketSchema} from "@grest-ts/websocket"
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
// The SAME cookie key (and handler) the HTTP CookieTestApi binds — one wire, two transports.
// Its process() mints SESSION_VALUE and derives the connection scopes from the cookie.
import {SESSION} from "./CookieTestApi"

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
// session cookie resolves to no scopes and is rejected at the handshake (FORBIDDEN).
export const WsCookieApi = webSocketSchema(WsCookieApiContract)
    .path("ws/cookie-test")
    .use(SESSION)
    .connectPermission(AppPermission.Read)
    .done()

export type WsCookieIncoming = GGContractImplementation<typeof WsCookieApiContract.methods["clientToServer"]>
export type WsCookieOutgoing = GGContractClient<typeof WsCookieApiContract.methods["serverToClient"]>
