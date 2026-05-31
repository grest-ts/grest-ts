import {GGContextKey, type GGTransportMiddleware} from "@grest-ts/context"
import {IsString, type GGSchema} from "@grest-ts/schema"
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

export interface GGWireSmartOptions<P extends string = never> {
    scheme?: "bearer"
    permissions?: GGSchema<P>
}

export interface GGWireDumbOptions {
    scheme?: "bearer"
}

const WIRE_SCHEMA = IsString.orUndefined

/**
 * Base for credential wires (GGHeader, GGCookie). A wire IS a GGContextKey and a transport
 * middleware at once:
 *  - smart form (`{scheme?, permissions?}`): the wire is the ephemeral key holding the raw
 *    inbound credential. It is verified into a durable key during process(), then clear()d
 *    before the handler runs — handlers read the durable key, never the credential.
 *  - dumb form (a context key passed in): ambient. Parsed values land in that key, persist
 *    through the handler, and need no implementation.
 *
 * The server/inbound half (define/create/process/permissions) is attached node-side via
 * ./GGWireContextKey.node — the browser bundle never pulls @grest-ts/locator.
 */
export abstract class GGWireContextKey<P extends string = never>
    extends GGContextKey<string | undefined>
    implements GGTransportMiddleware {

    public readonly wireName: string
    public readonly isSmart: boolean
    public readonly scheme?: "bearer"
    public readonly permissionSchema?: GGSchema<P>
    /** Where parsed values land: `this` (smart, ephemeral) or the wrapped key (dumb, ambient). */
    public readonly target: GGContextKey<string | undefined>
    public readonly key: GGContextKey<string | undefined> | undefined

    protected constructor(
        name: string,
        keyOrOptions: GGContextKey<string | undefined> | GGWireSmartOptions<P>,
        dumbOptions?: GGWireDumbOptions,
    ) {
        super(name, WIRE_SCHEMA)
        this.wireName = name.toLowerCase()
        if (keyOrOptions instanceof GGContextKey) {
            this.isSmart = false
            this.target = keyOrOptions
            this.key = undefined
            this.scheme = dumbOptions?.scheme
        } else {
            this.isSmart = true
            this.scheme = keyOrOptions.scheme
            this.permissionSchema = keyOrOptions.permissions
            this.target = this
            this.key = this
        }
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

    /** Outbound value to attach: the defineClient value() if set, else the ambient key value. */
    public outboundValue(): string | undefined {
        return this._clientHandler ? this._clientHandler.value() : this.target.get()
    }

    /** Drop the ephemeral raw credential after process(); ambient (dumb) wires keep their value. */
    public clear(): void {
        if (this.isSmart && this.has()) this.delete()
    }

    /** The permission strings this wire owns (its enum literals). Empty for dumb / permission-less wires. */
    public permissionStrings(): readonly string[] {
        const def = this.permissionSchema?.def as {type?: string; values?: readonly unknown[]} | undefined
        if (def?.type === "literal" && Array.isArray(def.values)) {
            return def.values.map(String)
        }
        return []
    }
}
