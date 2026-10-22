import {GGRawWebSocketSchema} from "@grest-ts/websocket"
import {FORBIDDEN, GGRawSocketContract, NOT_AUTHORIZED, SERVER_ERROR} from "@grest-ts/schema"
import {AppPermission} from "./PermissionsApi"
import {WS_SESSION} from "./WsCookieApi"

/**
 * customClient byte socket on a wildcard prefix path — mirrors how a foreign app (e.g. code-server)
 * opens WS upgrades at dynamic subpaths under one base. The exact-match dispatcher would miss those,
 * so the schema declares `/cc-proxy/*`. Public (no auth) for the test; the handler echoes back the
 * concrete upgrade path to prove prefix matching + GGWsUpgrade access.
 */
export const CustomClientProxyApiContract = new GGRawSocketContract("CustomClientProxyApi", {
    connect: {errors: [SERVER_ERROR]},
    customClient: true,
})

export const CustomClientProxyApi = new GGRawWebSocketSchema({
    contract: CustomClientProxyApiContract,
    path: "/cc-proxy/*",
})

/** customClient byte socket behind the parse-only `session` cookie wire: auth runs on the upgrade itself. */
export const CustomClientCookieApi = new GGRawWebSocketSchema({
    contract: new GGRawSocketContract("CustomClientCookieApi", {
        connect: {permission: AppPermission.Read, errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR]},
        customClient: true,
    }),
    path: "/cc-cookie",
    use: [WS_SESSION],
})
