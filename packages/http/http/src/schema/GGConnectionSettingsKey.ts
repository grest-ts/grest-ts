import {GGContextKey, IsConnectionSettings, type GGConnectionSettings, type GGTransportMiddleware} from "@grest-ts/context"

/**
 * A context key that is also a transport middleware: it holds per-request connection settings
 * (e.g. a TLS pin) in ambient context and contributes them to the outbound request.
 *
 *   export const CONN = new GGConnectionSettingsKey("conn")
 *   // schema: use: [CONN]
 *   CONN.set({host, port, tlsPin: {fingerprint256}})   // inside the request scope, then call the client
 *
 * Apps create their own instances (one per target class) — there is no framework singleton.
 * Browser-safe: it only reads ambient context and copies plain data; the node transport
 * consumes the settings, the browser fetch transport rejects them (settings are node-only).
 *
 * Nothing special — just a `GGContextKey<GGConnectionSettings>` whose `connectionSettings()`
 * hook copies its own value out. The same could be written inline; this is the shortcut.
 */
export class GGConnectionSettingsKey extends GGContextKey<GGConnectionSettings> implements GGTransportMiddleware {

    constructor(name: string) {
        super(name, IsConnectionSettings)
    }

    public connectionSettings(settings: GGConnectionSettings): void {
        const value = this.get()
        if (value) Object.assign(settings, value)
    }
}
