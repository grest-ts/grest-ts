import {defineSocketContract, webSocketSchema} from "@grest-ts/websocket"

/**
 * customClient byte socket on a wildcard prefix path — mirrors how a foreign app (e.g. code-server)
 * opens WS upgrades at dynamic subpaths under one base. The exact-match dispatcher would miss those,
 * so the schema declares `/cc-proxy/*`. Public (no auth) for the test; the handler echoes back the
 * concrete upgrade path to prove prefix matching + GGWsUpgrade access.
 */
export const CustomClientProxyApi = webSocketSchema(defineSocketContract("CustomClientProxyApi", {raw: true, customClient: true}))
    .path("/cc-proxy/*")
    .done()
