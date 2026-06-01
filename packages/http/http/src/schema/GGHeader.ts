import {type GGInbound, type GGOutbound} from "@grest-ts/context"
import {type GGSchema, IsString} from "@grest-ts/schema"
import {GGWireContextKey} from "./GGWireContextKey"

const BEARER = "Bearer "

/**
 * A request header that IS its own context key.
 *
 *   // verified: requires .define() server-side; raw credential is ephemeral.
 *   const USER_TOKEN_WIRE = new GGHeader("authorization", {scheme: "bearer"})
 *
 *   // ambient: parsed value lands in the wire and persists, no implementation needed.
 *   const CLIENT_VERSION_WIRE = new GGHeader("x-client-version")
 */
export class GGHeader extends GGWireContextKey {

    public readonly headers: Record<string, GGSchema<string | undefined>>
    public readonly scheme?: "bearer"

    constructor(name: string, options?: {scheme?: "bearer"}) {
        super(name)
        this.scheme = options?.scheme
        this.headers = {[this.wireName]: IsString.orUndefined}
    }

    public parse(inbound: GGInbound): void {
        const raw = inbound.headers[this.wireName];
        if (raw === undefined) {
            return undefined
        }
        const value = this.scheme === "bearer" && raw.startsWith(BEARER) ? raw.slice(BEARER.length) : raw
        if (value !== undefined) {
            this.set(value)
        }
    }

    public update(outbound: GGOutbound): void {
        const value = this.outboundValue()
        if (value !== undefined) {
            outbound.headers[this.wireName] = (this.scheme === "bearer" ? `${BEARER}${value}` : value)
        }
    }
}
