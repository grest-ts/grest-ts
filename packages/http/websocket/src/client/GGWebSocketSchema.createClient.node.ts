/**
 * Node half of URL-less websocket clients: resolve the base URL through
 * @grest-ts/discovery. Node-only — keeps the (node-only) discovery package out
 * of the browser bundle. The import stays dynamic so discovery remains an
 * optional integration, not a hard dependency of @grest-ts/websocket.
 */
import {_registerWsDiscoveryUrlResolver} from "./GGWebSocketSchema.createClient"

_registerWsDiscoveryUrlResolver(async (apiName: string): Promise<string> => {
    const {GG_DISCOVERY} = await import("@grest-ts/discovery")
    return GG_DISCOVERY.get().discoverApi(apiName)
})
