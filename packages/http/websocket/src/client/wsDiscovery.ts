/**
 * Base-URL resolution shared by the typed and raw websocket clients.
 *
 * A URL-less client resolves its base URL from the schema name via
 * @grest-ts/discovery. Discovery is node-only, and bundlers follow even a
 * dynamic `import()` at build time regardless of runtime reachability, so the
 * browser bundle must never reference it: the node entry
 * (./GGWebSocketSchema.createClient.node) registers the resolver here, and the
 * browser leaves it unset (an explicit `url` is required there).
 */

import {SERVER_ERROR} from "@grest-ts/schema"

let discoveryUrlResolver: ((apiName: string) => Promise<string>) | undefined

export function _registerWsDiscoveryUrlResolver(resolver: (apiName: string) => Promise<string>): void {
    discoveryUrlResolver = resolver
}

export async function resolveWsDomain(url: string | undefined, schemaName: string): Promise<string> {
    if (url !== undefined) return url
    try {
        if (!discoveryUrlResolver) {
            throw new Error("Service discovery is not available in this environment")
        }
        return await discoveryUrlResolver(schemaName)
    } catch (err) {
        throw new SERVER_ERROR({
            displayMessage: "Service discovery failed for WebSocket API " + schemaName,
            originalError: err,
        })
    }
}
