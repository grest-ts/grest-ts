import {createLocalJWKSet, jwtVerify, type JWK} from "jose"
import type {SigningStrategy} from "./SigningStrategy"
import type {JwsSigner} from "./JwsSigner"
import {toNotAuthorized} from "./verifyError"

// Signs with `active`; also publishes `published` (the next key during a rotation, or the previous
// one until its last token expires) so verifiers already know a key before it signs.
export class JwsSigningStrategy implements SigningStrategy {

    private readonly active: JwsSigner
    private readonly published: () => JwsSigner[]

    constructor(active: JwsSigner, published: () => JwsSigner[] = () => []) {
        this.active = active
        this.published = published
    }

    public sign = async (claims: Record<string, unknown>): Promise<string> => {
        const header = {alg: this.active.alg, kid: await this.active.kid(), typ: "at+jwt"}
        const input = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(claims))}`
        const signature = await this.active.sign(new TextEncoder().encode(input))
        return `${input}.${Buffer.from(signature).toString("base64url")}`
    }

    public verify = async (token: string): Promise<Record<string, unknown>> => {
        try {
            const keys = createLocalJWKSet({keys: await this.publicJwks()})
            const {payload} = await jwtVerify(token, keys, {algorithms: [this.active.alg]})
            return payload as Record<string, unknown>
        } catch (err) {
            throw toNotAuthorized(err)
        }
    }

    public publicJwks = async (): Promise<JWK[]> =>
        Promise.all([this.active, ...this.published()].map(s => s.publicJwk()))
}

function b64(s: string): string {
    return Buffer.from(s).toString("base64url")
}
