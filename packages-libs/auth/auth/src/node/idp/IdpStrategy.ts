// Normalized identity an IdP asserts, before the app maps it to its own user.
export interface ExternalIdentity {
    provider: string
    // Stable provider-unique id (the OIDC `sub`).
    subject: string
    email?: string
    emailVerified?: boolean
    name?: string
    // Raw verified claims, for provider-specific extraction.
    claims: Record<string, unknown>
}

// Turns a provider credential `I` into a normalized ExternalIdentity (input varies per
// provider: Google ID-token string, password {username,password}, ...). The app maps the
// identity to a subject + permissions; the lib never decides identity or authorization.
export interface IdpStrategy<I> {
    readonly provider: string
    authenticate(input: I): Promise<ExternalIdentity>
}
