import {GGContextKey, type GGTransportMiddleware} from "@grest-ts/context"
import {IsString} from "@grest-ts/schema"
import {GGContextKeySynchronizer} from "../client/GGContextKeySynchronizer"

/** Client/outbound behaviour for a smart wire: the last-known value plus an optional refresh gate. */
export interface GGWireClientHandler {
    /** Sync — the last-known credential to attach outbound. */
    value: () => string | undefined
    /** Async — true when value() is stale and recover() should run before the next outbound read. */
    isStale?: () => boolean
    /** Async — refresh the credential; run by the synchronizer's waitFor before value() is read. */
    recover?: () => Promise<void>
}

const WIRE_SCHEMA = IsString.orUndefined

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

    public readonly wireName: string
    public isSmart = false

    protected constructor(name: string) {
        super(name, WIRE_SCHEMA)
        this.wireName = name.toLowerCase()
    }

    private _clientHandler?: GGWireClientHandler

    /**
     * Attach the client/outbound behaviour: the value to send and an optional refresh gate.
     * Freeze-once. The no-session case calls this directly (`WIRE.defineClient({value: () => KEY})`);
     * GGAuthSession calls it internally on the wires it holds.
     */
    public defineClient(handler: GGWireClientHandler): void {
        if (this._clientHandler) {
            throw new Error(`Wire "${this.name}" already has .defineClient() — it can only be defined once.`)
        }
        this._clientHandler = handler
        if (handler.isStale || handler.recover) {
            GGContextKeySynchronizer.provide(this, {
                isStale: handler.isStale ?? (() => false),
                recover: handler.recover ?? (async () => {}),
            })
        }
    }

    /** Outbound value to attach: the defineClient value() if set, else the ambient wire value. */
    public outboundValue(): string | undefined {
        return this._clientHandler ? this._clientHandler.value() : this.get()
    }

    /** Drop the ephemeral raw credential after process(); ambient wires keep their value. */
    public clear(): void {
        if (this.isSmart && this.has()) this.delete()
    }
}
