import {type GGContextKey, type GGInbound, type GGOutbound} from "@grest-ts/context"
import {type GGSchema, IsString} from "@grest-ts/schema"
import {GGWireContextKey, type GGWireDumbOptions, type GGWireSmartOptions} from "./GGWireContextKey"

const BEARER = "Bearer "

/**
 * A request header bound to a context key.
 *
 *   // smart: the wire IS the ephemeral key; requires .define() server-side.
 *   const USER_TOKEN_WIRE = new GGHeader("authorization", {scheme: "bearer", permissions: IsUserPermission})
 *
 *   // dumb: ambient — parsed value lands in the passed key, no implementation needed.
 *   const CLIENT_VERSION_WIRE = new GGHeader("x-client-version", CLIENT_VERSION)
 */
export class GGHeader<P extends string = never> extends GGWireContextKey<P> {

    public readonly headers: Record<string, GGSchema<string | undefined>>

    constructor(
        name: string,
        keyOrOptions: GGContextKey<string | undefined> | GGWireSmartOptions<P>,
        dumbOptions?: GGWireDumbOptions,
    ) {
        super(name, keyOrOptions, dumbOptions)
        this.headers = {[this.wireName]: IsString.orUndefined}
    }

    public parse(inbound: GGInbound): void {
        const raw = inbound.headers[this.wireName];
        if (raw === undefined) {
            return undefined
        }
        const value = this.scheme === "bearer" && raw.startsWith(BEARER) ? raw.slice(BEARER.length) : raw
        if (value !== undefined) {
            this.target.set(value)
        }
    }

    public update(outbound: GGOutbound): void {
        const value = this.outboundValue()
        if (value !== undefined) {
            outbound.headers[this.wireName] = (this.scheme === "bearer" ? `${BEARER}${value}` : value)
        }
    }
}
