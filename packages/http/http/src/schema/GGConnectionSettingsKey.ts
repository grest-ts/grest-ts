import {GGContextKey, IsConnectionSettings, type GGConnectionSettings, type GGTransportMiddleware} from "@grest-ts/context"

/**
 * A context key that is also a transport middleware: it holds per-request connection settings
 * (e.g. a TLS pin) in ambient context and contributes them to the outbound request.
 *
 *   export const RELAY_CONN = new GGConnectionSettingsKey("relayConn")
 *   // schema: use: [RELAY_CONN]
 *   RELAY_CONN.run({tlsPin: {host, port, fingerprint256}}, () => client.method(args))
 *
 * Apps create their own instances (one per target class) — there is no framework singleton.
 * Browser-safe: it only reads ambient context and copies plain data; the node transport
 * consumes the settings, the browser fetch transport rejects them (settings are node-only).
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
