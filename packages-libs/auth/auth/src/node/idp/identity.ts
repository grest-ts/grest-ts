import {NOT_AUTHORIZED} from "@grest-ts/schema"
import type {ExternalIdentity} from "./IdpStrategy"

// Normalize verified OIDC/JWT claims into an ExternalIdentity. Shared by Google + generic OIDC.
export function identityFromClaims(provider: string, claims: Record<string, unknown>): ExternalIdentity {
    const sub = claims["sub"]
    if (typeof sub !== "string") throw new NOT_AUTHORIZED({debugMessage: "TOKEN_INVALID: missing sub"})
    return {
        provider,
        subject: sub,
        email: typeof claims["email"] === "string" ? claims["email"] : undefined,
        emailVerified: claims["email_verified"] === true,
        name: typeof claims["name"] === "string" ? claims["name"] : undefined,
        claims,
    }
}
