/**
 * Node half of URL-less clients: resolve the base URL through @grest-ts/discovery.
 * Node-only — keeps the (node-only) discovery package out of the browser bundle.
 * The import stays dynamic so discovery remains an optional integration, not a
 * hard dependency of @grest-ts/http.
 */
import {_registerDiscoveryUrlResolver, _registerNodeDefaultTransport} from "./GGHttpSchema.createClient"
import {nodeDefaultTransport} from "./nodeConnectionTransport.node"

export const discoveryUrlResolver = async (apiName: string): Promise<string> => {
    const {GG_DISCOVERY} = await import('@grest-ts/discovery')
    return GG_DISCOVERY.get().discoverApi(apiName)
}

_registerDiscoveryUrlResolver(discoveryUrlResolver)
_registerNodeDefaultTransport(nodeDefaultTransport)
