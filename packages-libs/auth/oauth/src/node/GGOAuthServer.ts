import {randomBytes} from "node:crypto"
import type {IncomingMessage, ServerResponse} from "node:http"
import Provider, {errors as oidcErrors, type Configuration, type InteractionResults, type KoaContextWithOIDC} from "oidc-provider"
import {NOT_FOUND} from "@grest-ts/schema"
import type {GGHttpServer} from "@grest-ts/http"
import type {GGAuthAccessToken} from "@grest-ts/auth"
import {GGOAuthInteractionContract, type GGOAuthInteraction} from "../shared/interactionContract"
import {toOidcAdapter, type GGOAuthStore} from "./store/GGOAuthStore"

export interface GGOAuthFirstPartyClient {
    clientId: string
    name: string
    redirectUris: string[]
    postLogoutRedirectUris?: string[]
}

export interface GGOAuthServerOptions<C extends object> {
    // Public origin of the authorization server, no path (e.g. https://auth.example.com).
    issuer: () => string
    store: GGOAuthStore
    // ES256 private JWK (JSON string) for the provider's own JWKS (id tokens). Not used for access tokens.
    signingJwk: () => string
    cookieKeys: () => string[]
    // The access token clients receive IS this token kind — same signer, audience, TTL and claim
    // schema — so the app's existing wire verifies it unchanged. Its signer must expose jwsKey().
    accessToken: GGAuthAccessToken<C>
    // RFC 8707 resource indicator of the protected API; also the default when a client sends none.
    resource: () => string
    // Scopes clients may request for the resource. At least one: a request granting no scope is
    // refused. The token carries them in `scope`; what they permit is up to the app.
    scopes: [string, ...string[]]
    // Re-run at every issuance (code exchange and each refresh), like GGAuthRefreshToken's resolve:
    // permission changes apply on refresh. undefined = subject gone → invalid_grant.
    claims: (subject: string, client: {clientId: string}) => Promise<C | undefined>
    // The app's login/consent page; it receives the interaction uid and uses GGOAuthInteractionContract.
    interactionUrl: (uid: string) => string
    // Pre-registered app clients: no consent screen, silent re-auth while the login session lives.
    firstPartyClients?: GGOAuthFirstPartyClient[]
    // Let any client self-register (RFC 7591) or identify by a metadata URL (CIMD, MCP's preferred way).
    dynamicRegistration?: boolean
    clientIdMetadataDocument?: boolean
    // Absolute refresh lifetime: rotation never extends it (OAuth for browser apps, RFC 10017).
    refreshTtlSec?: number
    sessionTtlSec?: number
    // Trust X-Forwarded-* (behind a TLS-terminating load balancer).
    proxy?: boolean
}

const BASE = "/oauth"
const OIDC_SCOPES = ["openid", "offline_access"]
const TICKET = "GGOAuthTicket"

type Ticket = {uid: string, result: InteractionResults}

// OAuth 2.1 authorization server on a GGHttpServer. Protocol (PKCE, DCR, CIMD, resource indicators,
// RFC 9207 iss, refresh rotation + reuse revocation, revocation, discovery) is panva oidc-provider;
// this class owns the grest-ts seams: mounting, storage, token claims and the login/consent handoff.
export class GGOAuthServer<C extends object> {

    private _provider: Provider | undefined
    private readonly options: GGOAuthServerOptions<C>
    private readonly firstParty: Map<string, GGOAuthFirstPartyClient>

    constructor(options: GGOAuthServerOptions<C>) {
        this.options = options
        this.firstParty = new Map((options.firstPartyClients ?? []).map(c => [c.clientId, c]))
    }

    public mount(server: GGHttpServer): void {
        const handle = async (req: IncomingMessage, res: ServerResponse) => {
            const path = new URL(req.url ?? "/", "http://x").pathname
            const interaction = path.match(/^\/oauth\/interaction\/([^/]+)(\/complete)?$/)
            if (interaction && req.method === "GET") {
                if (interaction[2]) return this.finishInteraction(req, res, interaction[1])
                res.writeHead(303, {location: this.options.interactionUrl(interaction[1])})
                res.end()
                return
            }
            if (path === "/.well-known/oauth-authorization-server") req.url = "/.well-known/openid-configuration"
            await this.provider().callback()(req, res)
        }
        for (const method of ["GET", "POST"] as const) server.registerRoute(method, `${BASE}/*`, handle, "GGOAuthServer")
        server.registerRoute("GET", "/.well-known/openid-configuration", handle, "GGOAuthServer")
        server.registerRoute("GET", "/.well-known/oauth-authorization-server", handle, "GGOAuthServer")
    }

    // Implementation of GGOAuthInteractionContract; `subject` reads the signed-in user from the app's wire.
    public interactionApi(subject: () => string): typeof GGOAuthInteractionContract.infer {
        return {
            get: async ({uid}) => this.describeInteraction(uid),
            approve: async ({uid}) => ({redirectUrl: await this.approve(uid, subject())}),
            deny: async ({uid}) => ({redirectUrl: await this.ticket(uid, {error: "access_denied", error_description: "The user denied the request"})}),
        }
    }

    public listGrants = async (subject: string): Promise<Array<{grantId: string, clientId: string, clientName: string}>> => {
        const p = this.provider()
        const out: Array<{grantId: string, clientId: string, clientName: string}> = []
        for (const grantId of await this.options.store.listIdsByAccount("Grant", subject)) {
            const grant = await p.Grant.find(grantId)
            if (!grant?.clientId || grant.accountId !== subject) continue
            const client = await p.Client.find(grant.clientId)
            out.push({grantId, clientId: grant.clientId, clientName: String(client?.clientName ?? grant.clientId)})
        }
        return out
    }

    // Kills the grant's refresh tokens and codes now; already-issued access tokens live out their TTL.
    public revokeGrant = async (subject: string, grantId: string): Promise<void> => {
        const grant = await this.provider().Grant.find(grantId)
        if (!grant || grant.accountId !== subject) throw new NOT_FOUND()
        await this.options.store.revokeByGrantId(grantId)
    }

    // "Log out everywhere": every grant and login session of the subject.
    public revokeAll = async (subject: string): Promise<void> => {
        const store = this.options.store
        for (const grantId of await store.listIdsByAccount("Grant", subject)) await store.revokeByGrantId(grantId)
        for (const sessionId of await store.listIdsByAccount("Session", subject)) await store.destroy("Session", sessionId)
    }

    private async describeInteraction(uid: string): Promise<GGOAuthInteraction> {
        const p = this.provider()
        const interaction = await p.Interaction.find(uid)
        if (!interaction) throw new NOT_FOUND({debugMessage: "Unknown or expired OAuth interaction"})
        const clientId = String(interaction.params.client_id)
        const client = await p.Client.find(clientId)
        if (!client) throw new NOT_FOUND({debugMessage: "Unknown OAuth client"})
        const hosts = [...new Set((client.redirectUris ?? []).map(u => new URL(u).host))]
        return {
            uid,
            client: {
                clientId,
                name: this.firstParty.get(clientId)?.name ?? String(client.clientName ?? clientId),
                firstParty: this.firstParty.has(clientId),
                redirectHosts: hosts,
                loopbackOnly: hosts.length > 0 && hosts.every(h => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h)),
            },
            scopes: String(interaction.params.scope ?? "").split(" ").filter(Boolean),
        }
    }

    private async approve(uid: string, subject: string): Promise<string> {
        const p = this.provider()
        const interaction = await p.Interaction.find(uid)
        if (!interaction) throw new NOT_FOUND({debugMessage: "Unknown or expired OAuth interaction"})
        const clientId = String(interaction.params.client_id)
        const existing = interaction.grantId ? await p.Grant.find(interaction.grantId) : undefined
        const grant = existing?.accountId === subject ? existing : new p.Grant({accountId: subject, clientId})
        this.grantRequested(grant, interaction.params)
        const grantId = await grant.save()
        return this.ticket(uid, {login: {accountId: subject}, consent: {grantId}})
    }

    // The result is applied only when the browser that started the flow (it holds the interaction
    // cookie) follows the redirect: a user approving someone else's flow can't hand them a code.
    private async ticket(uid: string, result: InteractionResults): Promise<string> {
        if (!await this.provider().Interaction.find(uid)) throw new NOT_FOUND({debugMessage: "Unknown or expired OAuth interaction"})
        const id = randomBytes(24).toString("base64url")
        await this.options.store.upsert(TICKET, id, {uid, result} satisfies Ticket, 120)
        return `${this.options.issuer()}${BASE}/interaction/${uid}/complete?ticket=${id}`
    }

    private async finishInteraction(req: IncomingMessage, res: ServerResponse, uid: string): Promise<void> {
        const id = new URL(req.url ?? "/", "http://x").searchParams.get("ticket") ?? ""
        const ticket = id ? await this.options.store.find(TICKET, id) as Ticket | undefined : undefined
        if (id) await this.options.store.destroy(TICKET, id)
        if (!ticket || ticket.uid !== uid) {
            res.writeHead(400, {"content-type": "text/plain"})
            res.end("Invalid or expired sign-in link")
            return
        }
        try {
            await this.provider().interactionFinished(req, res, ticket.result, {mergeWithLastSubmission: false})
        } catch (err) {
            if (!(err instanceof oidcErrors.SessionNotFound)) throw err
            res.writeHead(400, {"content-type": "text/plain"})
            res.end("This sign-in was started in another browser")
        }
    }

    private grantRequested(grant: InstanceType<Provider["Grant"]>, params: Record<string, unknown>): void {
        const requested = String(params.scope ?? "").split(" ").filter(Boolean)
        const oidc = requested.filter(s => OIDC_SCOPES.includes(s))
        if (oidc.length) grant.addOIDCScope(oidc.join(" "))
        const resourceScopes = requested.filter(s => this.options.scopes.includes(s))
        if (resourceScopes.length) grant.addResourceScope(this.options.resource(), resourceScopes.join(" "))
    }

    private provider(): Provider {
        if (this._provider) return this._provider
        const o = this.options
        const jws = o.accessToken.signer.jwsKey?.()
        if (!jws) throw new Error("GGOAuthServer: accessToken signer must implement jwsKey() (e.g. HmacSigner)")
        const accessTtlSec = Math.floor(o.accessToken.accessTtlMs / 1000)
        const refreshTtlSec = o.refreshTtlSec ?? 30 * 24 * 3600
        const firstParty = this.firstParty

        const config: Configuration = {
            adapter: toOidcAdapter(o.store),
            jwks: {keys: [{...JSON.parse(o.signingJwk()), use: "sig"}]},
            cookies: {keys: o.cookieKeys()},
            clients: [...firstParty.values()].map(c => ({
                client_id: c.clientId,
                client_name: c.name,
                redirect_uris: c.redirectUris,
                post_logout_redirect_uris: c.postLogoutRedirectUris ?? [],
                token_endpoint_auth_method: "none",
                grant_types: ["authorization_code", "refresh_token"],
                response_types: ["code"],
            })),
            clientDefaults: {
                grant_types: ["authorization_code", "refresh_token"],
                response_types: ["code"],
                token_endpoint_auth_method: "none",
                id_token_signed_response_alg: "ES256",
            },
            routes: {
                authorization: `${BASE}/authorize`, token: `${BASE}/token`, registration: `${BASE}/register`,
                jwks: `${BASE}/jwks`, revocation: `${BASE}/revoke`, end_session: `${BASE}/logout`, userinfo: `${BASE}/userinfo`,
                introspection: `${BASE}/introspect`, pushed_authorization_request: `${BASE}/par`, code_verification: `${BASE}/device`,
                device_authorization: `${BASE}/device/auth`, backchannel_authentication: `${BASE}/backchannel`, challenge: `${BASE}/challenge`,
            },
            interactions: {url: (_ctx, interaction) => `${BASE}/interaction/${interaction.uid}`},
            scopes: OIDC_SCOPES,
            pkce: {required: () => true},
            features: {
                devInteractions: {enabled: false},
                revocation: {enabled: true},
                registration: {enabled: !!o.dynamicRegistration},
                ...(o.clientIdMetadataDocument ? {clientIdMetadataDocument: {enabled: true, ack: "draft-02"}} : {}),
                rpInitiatedLogout: {
                    enabled: true,
                    // Skip the provider's "do you want to sign out?" page.
                    logoutSource: async (ctx, form) => {
                        ctx.body = `<!DOCTYPE html><html><body>${form}<script>document.forms[0].submit()</script></body></html>`
                    },
                },
                resourceIndicators: {
                    enabled: true,
                    defaultResource: () => o.resource(),
                    useGrantedResource: () => true,
                    getResourceServerInfo: (_ctx, resource) => {
                        if (resource !== o.resource()) throw new oidcErrors.InvalidTarget()
                        return {
                            scope: o.scopes.join(" "),
                            audience: o.accessToken.audience ?? resource,
                            accessTokenTTL: accessTtlSec,
                            accessTokenFormat: "jwt",
                            jwt: {sign: {alg: jws.alg as "HS256", key: Buffer.from(jws.key)}},
                        }
                    },
                },
            },
            // First-party clients never see a consent screen: an existing login session is enough.
            loadExistingGrant: async (ctx) => {
                const client = ctx.oidc.client!
                const session = ctx.oidc.session!
                const grantId = ctx.oidc.result?.consent?.grantId || session.grantIdFor(client.clientId)
                if (grantId) return ctx.oidc.provider.Grant.find(grantId)
                if (!firstParty.has(client.clientId) || !session.accountId) return undefined
                const grant = new ctx.oidc.provider.Grant({accountId: session.accountId, clientId: client.clientId})
                this.grantRequested(grant, ctx.oidc.params as Record<string, unknown>)
                await grant.save()
                session.ensureClientContainer(client.clientId)
                session.grantIdFor(client.clientId, grant.jti)
                return grant
            },
            // MCP clients don't reliably request offline_access; every code-flow client gets a refresh token.
            issueRefreshToken: async (_ctx, client) => client.grantTypeAllowed("refresh_token"),
            extraTokenClaims: async (_ctx: KoaContextWithOIDC, token) => {
                if (token.kind !== "AccessToken") return undefined
                const at = token as InstanceType<Provider["AccessToken"]>
                const claims = await o.claims(String(at.accountId), {clientId: String(at.clientId)})
                if (!claims) throw new oidcErrors.InvalidGrant("subject is no longer valid")
                return {data: o.accessToken.encodeClaims(claims)}
            },
            findAccount: async (_ctx, sub) => ({accountId: sub, claims: async () => ({sub})}),
            ttl: {
                AccessToken: accessTtlSec,
                AuthorizationCode: 60,
                Interaction: 30 * 60,
                Session: o.sessionTtlSec ?? 30 * 24 * 3600,
                Grant: 365 * 24 * 3600,
                RefreshToken: (ctx, token) => {
                    const rotated = ctx?.oidc.entities.RotatedRefreshToken
                    return rotated && !token.isSenderConstrained() ? rotated.remainingTTL : refreshTtlSec
                },
            },
            renderError: async (ctx, out) => {
                ctx.type = "text/plain"
                ctx.body = `${out.error}: ${out.error_description ?? ""}`
            },
        }
        const provider = new Provider(o.issuer(), config)
        provider.proxy = !!o.proxy
        this._provider = provider
        return provider
    }
}

