import * as oidc from "openid-client"
import {NOT_AUTHORIZED} from "@grest-ts/schema"
import type {ExternalIdentity} from "./IdpStrategy"
import {identityFromClaims} from "./identity"

// Read at use, so a settings change applies without a restart.
export interface OidcRelyingPartyOptions {
    issuer: () => string
    clientId: () => string
    clientSecret: () => string | undefined
    // Registered at the IdP; the callback must arrive on exactly this URL.
    redirectUri: () => string
    // Space-separated, e.g. "openid email profile offline_access".
    scope: () => string
    // ExternalIdentity.provider (default "oidc").
    provider?: string
    fetch?: oidc.CustomFetch
}

// Kept server-side (e.g. a signed cookie) between the redirect and the callback; the PKCE verifier must never travel in the URL.
export interface OidcAuthorizationChecks {
    state: string
    nonce: string
    pkceVerifier: string
}

export interface OidcSignIn {
    identity: ExternalIdentity
    // Present when the IdP granted one (usually for `offline_access`): refresh() re-checks the session with it.
    refreshToken: string | undefined
}

export type OidcRefresh =
    // `claims`: the refreshed ID token's, when the IdP sent one.
    | {ended: false, refreshToken: string, accessToken: string, claims: Record<string, unknown> | undefined}
    // The IdP no longer honours the session: the user was deactivated or unassigned, or the grant expired or was revoked.
    | {ended: true, reason: string}

// A confidential OIDC client (authorization code + PKCE, client_secret_basic) on openid-client.
export class OidcRelyingParty {

    private cached: {key: string, config: Promise<oidc.Configuration>} | undefined
    private readonly options: OidcRelyingPartyOptions

    constructor(options: OidcRelyingPartyOptions) {
        this.options = options
    }

    // `extra`: more authorization parameters (e.g. prompt, login_hint); a given `state` is used as the state.
    public authorize = async (extra: Record<string, string> = {}): Promise<{url: string, checks: OidcAuthorizationChecks}> => {
        const config = await this.configuration()
        const checks = {state: extra.state ?? oidc.randomState(), nonce: oidc.randomNonce(), pkceVerifier: oidc.randomPKCECodeVerifier()}
        const url = oidc.buildAuthorizationUrl(config, {
            ...extra,
            redirect_uri: this.options.redirectUri(),
            scope: this.options.scope(),
            state: checks.state,
            nonce: checks.nonce,
            code_challenge: await oidc.calculatePKCECodeChallenge(checks.pkceVerifier),
            code_challenge_method: "S256",
        })
        return {url: url.href, checks}
    }

    // The callback URL is rebuilt from redirectUri, not the request: behind a TLS-terminating proxy the request
    // looks like http://, and redirect_uri must match the authorize request byte-for-byte.
    public callback = async (callbackQuery: string, checks: OidcAuthorizationChecks): Promise<OidcSignIn> => {
        const config = await this.configuration()
        const current = new URL(this.options.redirectUri())
        current.search = callbackQuery
        const tokens = await oidc.authorizationCodeGrant(config, current, {
            pkceCodeVerifier: checks.pkceVerifier,
            expectedState: checks.state,
            expectedNonce: checks.nonce,
            idTokenExpected: true,
        })
        return {identity: identityFromClaims(this.options.provider ?? "oidc", tokens.claims()!), refreshToken: tokens.refresh_token}
    }

    // Spends `refreshToken` to learn whether the IdP still honours `subject`'s session. Throws when the IdP can't be asked.
    public refresh = async (refreshToken: string, subject: string): Promise<OidcRefresh> => {
        const config = await this.configuration()
        let tokens: Awaited<ReturnType<typeof oidc.refreshTokenGrant>>
        try {
            tokens = await oidc.refreshTokenGrant(config, refreshToken)
        } catch (err) {
            if (err instanceof oidc.ResponseBodyError && err.error === "invalid_grant") return {ended: true, reason: err.error_description ?? err.error}
            throw err
        }
        const claims = tokens.claims()
        if (claims && claims.sub !== subject) return {ended: true, reason: "refreshed ID token is for another subject"}
        return {ended: false, refreshToken: tokens.refresh_token ?? refreshToken, accessToken: tokens.access_token, claims}
    }

    // The userinfo claims for `accessToken` (e.g. from refresh), or undefined when the IdP has no userinfo endpoint.
    // NOT_AUTHORIZED when they are for another subject; any other failure throws as is.
    public userinfo = async (accessToken: string, subject: string): Promise<Record<string, unknown> | undefined> => {
        const config = await this.configuration()
        if (!config.serverMetadata().userinfo_endpoint) return undefined
        const info = await oidc.fetchUserInfo(config, accessToken, oidc.skipSubjectCheck)
        if (info.sub !== subject) throw new NOT_AUTHORIZED({debugMessage: "userinfo is for another subject"})
        return info
    }

    private configuration(): Promise<oidc.Configuration> {
        const issuer = this.options.issuer()
        const clientId = this.options.clientId()
        const secret = this.options.clientSecret()
        const key = JSON.stringify([issuer, clientId, secret])
        if (this.cached?.key !== key) {
            const config = this.discover(issuer, clientId, secret)
            config.catch(() => { if (this.cached?.config === config) this.cached = undefined })
            this.cached = {key, config}
        }
        return this.cached.config
    }

    private async discover(issuer: string, clientId: string, secret: string | undefined): Promise<oidc.Configuration> {
        // client_secret_basic: the OIDC default when a client registers no method, and what IdPs default new apps to.
        const config = await oidc.discovery(new URL(issuer), clientId, undefined, oidc.ClientSecretBasic(secret), this.options.fetch ? {[oidc.customFetch]: this.options.fetch} : undefined)
        // The ID token arrives over the TLS back-channel, where the spec lets clients skip the JWS check; verify it anyway.
        oidc.enableNonRepudiationChecks(config)
        return config
    }
}
