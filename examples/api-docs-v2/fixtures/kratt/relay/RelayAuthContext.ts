import {GGContextKey, type GGInbound, type GGOutbound} from "@grest-ts/context"
import {IsString, type GGSchema} from "@grest-ts/schema"

const IsRelayToken = IsString.brand("RelayToken")
type tRelayToken = typeof IsRelayToken.infer

class RelayTokenTransport extends GGContextKey<tRelayToken> {
    readonly headers: Record<string, GGSchema<string | undefined>> = {"authorization": IsString.orUndefined}
    readonly responseHeaders: Record<string, GGSchema<string | undefined>> = {}

    update(outbound: GGOutbound): void {
        const token = GG_RELAY_TOKEN.get()
        if (token) {
            outbound.headers["authorization"] = `Bearer ${token}`
        }
    }

    parse(inbound: GGInbound): void {
        const authHeader = inbound.headers["authorization"]
        if (authHeader && authHeader.startsWith("Bearer ")) {
            GG_RELAY_TOKEN.set(authHeader.substring(7) as tRelayToken)
        }
    }
}

export const GG_RELAY_TOKEN = new RelayTokenTransport("relayToken", IsRelayToken)
