import type {JWK} from "jose"
import type {TokenSigner} from "./TokenSigner"
import type {JwsSigner} from "./JwsSigner"
import {JwksVerifier} from "./JwksVerifier"

// Signs with `active`; also publishes `published` (the next key during a rotation, or the previous
// one until its last token expires) so verifiers already know a key before it signs.
export class JwsSigningStrategy implements TokenSigner {

    private readonly active: JwsSigner
    private readonly published: () => JwsSigner[]
    private readonly verifier: JwksVerifier

    constructor(active: JwsSigner, published: () => JwsSigner[] = () => []) {
        this.active = active
        this.published = published
        // Not just active.alg: a published key of another algorithm (a rotation ES256 → EdDSA) must still verify.
        this.verifier = new JwksVerifier({jwks: this.publicJwks, algorithms: [...new Set([active.alg, "ES256", "EdDSA"])]})
    }

    public sign = async (claims: Record<string, unknown>): Promise<string> => {
        const header = {alg: this.active.alg, kid: await this.active.kid(), typ: "at+jwt"}
        const input = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(claims))}`
        const signature = await this.active.sign(new TextEncoder().encode(input))
        return `${input}.${Buffer.from(signature).toString("base64url")}`
    }

    public verify = (token: string): Promise<Record<string, unknown>> => this.verifier.verify(token)

    public publicJwks = async (): Promise<JWK[]> =>
        Promise.all([this.active, ...this.published()].map(s => s.publicJwk()))
}

function b64(s: string): string {
    return Buffer.from(s).toString("base64url")
}
