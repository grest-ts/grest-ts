import {GGContextKey} from "@grest-ts/context"
import type {GGHttpRequest} from "@grest-ts/http"
import {IsString, type GGSchema} from "@grest-ts/schema"

const IsRelayToken = IsString.brand("RelayToken")
type tRelayToken = typeof IsRelayToken.infer

class RelayTokenTransport extends GGContextKey<tRelayToken> {
    readonly headers: Record<string, GGSchema<string | undefined>> = {"authorization": IsString.orUndefined}
    readonly responseHeaders: Record<string, GGSchema<string | undefined>> = {}

    updateRequest(req: GGHttpRequest): void {
        const token = GG_RELAY_TOKEN.get()
        if (token) {
            req.headers = req.headers ?? {}
            req.headers["authorization"] = `Bearer ${token}`
        }
    }

    parseRequest(req: GGHttpRequest): void {
        const authHeader = req.headers?.["authorization"]
        if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
            GG_RELAY_TOKEN.set(authHeader.substring(7) as tRelayToken)
        }
    }
}

export const GG_RELAY_TOKEN = new RelayTokenTransport("relayToken", IsRelayToken)
