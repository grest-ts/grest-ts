import {hkdfSync} from "node:crypto"
import {SignJWT, jwtVerify} from "jose"
import type {TokenSigner} from "./TokenSigner"
import {toNotAuthorized} from "./verifyError"

// App-named by history; changing it invalidates every HMAC token, so only via a future versioned option.
const KEY_INFO = "@kratt/auth hs256 signing key"

export class HmacSigner implements TokenSigner {

    private readonly alg = "HS256"
    private readonly reveal: () => string

    // Read the secret on every op (never cache) so a GGSecret source honours runtime/test overrides.
    constructor(secret: string | (() => string)) {
        this.reveal = typeof secret === "function" ? secret : () => secret
    }

    // HKDF-SHA256 → 32-byte key, so any secret length/shape is accepted.
    private key(): Uint8Array {
        return new Uint8Array(hkdfSync("sha256", this.reveal(), "", KEY_INFO, 32))
    }

    public sign = async (claims: Record<string, unknown>): Promise<string> => {
        return await new SignJWT(claims)
            .setProtectedHeader({alg: this.alg, typ: "JWT"})
            .sign(this.key())
    }

    public verify = async (token: string): Promise<Record<string, unknown>> => {
        try {
            const {payload} = await jwtVerify(token, this.key(), {algorithms: [this.alg]})
            return payload as Record<string, unknown>
        } catch (err) {
            throw toNotAuthorized(err)
        }
    }
}
