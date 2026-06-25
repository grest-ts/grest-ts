import {GGRawWebSocketSchema} from "@grest-ts/websocket"
import {GGRawSocketContract, SERVER_ERROR} from "@grest-ts/schema"

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
