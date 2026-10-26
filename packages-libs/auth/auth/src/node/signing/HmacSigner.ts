import {hkdfSync} from "node:crypto"
import {SignJWT, jwtVerify, errors as joseErrors} from "jose"
import {NOT_AUTHORIZED} from "@grest-ts/schema"
import type {SigningStrategy} from "./SigningStrategy"

const KEY_INFO = "@kratt/auth hs256 signing key"

export class HmacSigner implements SigningStrategy {

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
            if (err instanceof joseErrors.JWTExpired) throw new NOT_AUTHORIZED({debugMessage: "TOKEN_EXPIRED"})
            throw new NOT_AUTHORIZED({debugMessage: "TOKEN_INVALID: " + (err as Error).message})
        }
    }
}
