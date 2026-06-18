import {GGContextKey, type GGTransportMiddleware} from "@grest-ts/context"
import {type GGSchema} from "@grest-ts/schema"
import {GGContextKeySynchronizer} from "../client/GGContextKeySynchronizer"

/** Outbound freshness gate for a smart wire. The outbound value is always the wire's own context value. */
export interface GGWireClientHandler {
    /** Async — true when the wire value is stale and recover() should run before the next outbound read. */
    isStale?: () => boolean
    /** Async — refresh the credential into the wire (via key.set); run by the synchronizer's waitFor before the outbound read. */
    recover?: () => Promise<void>
}

/**
 * Base for credential wires (GGHeader, GGCookie). A wire IS a GGContextKey and a transport
 * middleware at once. Verified vs ambient is decided by whether `.define()` was called:
 *  - verified (`.define()`d): the wire holds the raw inbound credential, which is verified
 *    during process(), then clear()d before the handler runs — handlers read the durable key
 *    minted by the handler, never the credential.
 *  - ambient (never `.define()`d): the parsed value lands in the wire and persists through the
 *    handler (read via WIRE.get()); no process, no clear, no implementation needed.
 *
 * The server/inbound half (define/create/process/permissions) is attached node-side via
 * ./GGWireContextKey.node — the browser bundle never pulls @grest-ts/locator.
 */
export abstract class GGWireContextKey extends GGContextKey<string | undefined> implements GGTransportMiddleware {

    declare readonly headers?: Record<string, GGSchema<string | undefined>>

    private _clientHandler?: GGWireClientHandler

    /**
     * Attach the outbound freshness gate. Freeze-once. The outbound value is always the wire's
     * context value; this only registers an isStale/recover gate that refreshes it before the read.
     * GGAuthSession calls it internally on the wires it holds.
     */
    public defineClient(handler: GGWireClientHandler): void {
        if (this._clientHandler) {
            throw new Error(`Wire "${this.name}" already has .defineClient() - it can only be defined once.`)
        }
        this._clientHandler = handler
        if (handler.isStale || handler.recover) {
            GGContextKeySynchronizer.provide(this, {
                isStale: handler.isStale ?? (() => false),
                recover: handler.recover ?? (async () => {
                }),
            })
        }
    }
}
