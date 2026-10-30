import {createHmac, randomBytes, timingSafeEqual} from "node:crypto"
import type {GGSecret} from "@grest-ts/config"
import type {GGHttpClientWire, GGWireContextKey, GGWireHandlerRegistration} from "@grest-ts/http"
import {GGLog} from "@grest-ts/logger"
import {NOT_AUTHORIZED} from "@grest-ts/schema"

// Comparing fixed-length HMAC digests keeps timingSafeEqual from leaking the secret's length.
const COMPARE_KEY = randomBytes(32)

/**
 * A secret header two services share. `verify` gives the wire its server half, `attach` its client
 * half. The secret is read per request, so both can be set up before the config store is live.
 */
export class GGSharedSecret {

    /** Fail-closed: an empty configured secret refuses every request. Call once per wire; `.create(secret)` per runtime. */
    public static verify(wire: GGWireContextKey): GGWireHandlerRegistration<GGSecret<string>> {
        return wire.define((secret: GGSecret<string>) => ({
            process: async () => {
                const expected = secret.reveal()
                if (!expected) {
                    GGLog.error("GGSharedSecret", `${wire.name} secret is empty — refusing all requests`)
                    throw new NOT_AUTHORIZED({debugMessage: `${wire.name} not configured`})
                }
                const presented = wire.get()
                if (!presented) {
                    GGLog.warn("GGSharedSecret", `Call without ${wire.name}`)
                    throw new NOT_AUTHORIZED({debugMessage: `Missing ${wire.name}`})
                }
                if (!GGSharedSecret.equals(presented, expected)) {
                    GGLog.warn("GGSharedSecret", `Call with wrong ${wire.name}`)
                    throw new NOT_AUTHORIZED({debugMessage: `Invalid ${wire.name}`})
                }
            },
        }))
    }

    /** For a client's `wires`: `Api.createClient({wires: [GGSharedSecret.attach(WIRE, secret)]})`. */
    public static attach(wire: GGWireContextKey, secret: GGSecret<string>): GGHttpClientWire {
        return {
            wire,
            value: () => {
                const value = secret.reveal()
                if (!value) throw new Error(`${wire.name} secret is empty`)
                return value
            },
        }
    }

    public static equals(a: string, b: string): boolean {
        return timingSafeEqual(digest(a), digest(b))
    }
}

function digest(value: string): Buffer {
    return createHmac("sha256", COMPARE_KEY).update(value).digest()
}
