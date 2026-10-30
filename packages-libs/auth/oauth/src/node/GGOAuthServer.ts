import {createECDH, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual} from "node:crypto"
import type {IncomingMessage, ServerResponse} from "node:http"
import {decodeJwt} from "jose"
import Provider, {errors as oidcErrors, type ClientMetadata, type Configuration, type InteractionResults, type KoaContextWithOIDC} from "oidc-provider"
import {FORBIDDEN, IsString, NOT_AUTHORIZED, NOT_FOUND} from "@grest-ts/schema"
import {GGLog} from "@grest-ts/logger"
import {GGContextKey} from "@grest-ts/context"
import {GGHttp, type GGHttpServer} from "@grest-ts/http"
import type {GGAccessPayload, GGAccessTokenData, GGAuthAccessToken, TokenVerifier} from "@grest-ts/auth"
import {GGOAuthResourceServer, type GGOAuthProtectedResource} from "./GGOAuthResourceServer"
import {toOidcAdapter, type GGOAuthStore} from "./store/GGOAuthStore"
import {GG_OAUTH_SERVICE_CLIENT, GGOAuthServiceApi, SUBJECT_TOKEN_INVALID} from "./GGOAuthServiceApi"
import {GGOAuthExternalSignIn, type GGOAuthExternalSignInOptions} from "./GGOAuthExternalSignIn"

export interface GGOAuthFirstPartyClient {
    clientId: string
    name: string
    redirectUris: string[]
    postLogoutRedirectUris?: string[]
    // false: codes buy only an access token — for a client that reads the identity once and keeps nothing.
    refreshTokens?: boolean
}

// One API the server issues tokens for (RFC 8707 resource indicator → its own audience and claims).
// `accessToken`: tokens for this resource ARE this token kind (signer, audience, TTL, claim schema),
// so the wire already verifying it accepts them. Any signer works (HMAC, a private key, KMS): the
// token is signed through it; its public keys join the JWKS. `scopes`: at least one; a request
// granting none is refused. What they permit is up to the app.
export interface GGOAuthResource<C extends object> extends GGOAuthProtectedResource<C> {
    accessToken: GGAuthAccessToken<C>
    // Re-run at every issuance (code exchange and each refresh), like GGAuthRefreshToken's resolve:
    // permission changes apply on refresh. undefined = subject gone → invalid_grant.
    claims: (subject: string, client: {clientId: string, name: string}) => Promise<C | undefined>
    // Who may get tokens for it. "any" (default): every client that signs a user in. "firstParty": only
    // pre-registered first-party clients. "service": only service clients, by GGOAuthServiceApi.token
    // (the subject is the client id); service clients get no other resource.
    clients?: "any" | "firstParty" | "service"
    // Issuable by GGOAuthServiceApi.exchange: a service client trades a valid `from` token for one for
    // this resource, for the same subject. `params` are the extra request parameters `claims` reads.
    exchange?: {
        // The token kind the subject presents (usually another resource's accessToken).
        from: GGAuthAccessToken<any, TokenVerifier>
        params?: string[]
        claims: (subject: string, params: Record<string, string | undefined>) => Promise<C | undefined>
    }
}

// A backend of the app: calls GGOAuthServiceApi with its secret, for its own tokens and token exchange.
export interface GGOAuthServiceClientRegistration {
    clientId: string
    secret: () => string
}

export interface GGOAuthInteractionClient {
    clientId: string
    name: string
    // Pre-registered by the app (its own UI). Third-party clients must be shown a consent screen.
    firstParty: boolean
    // Hosts the authorization code is sent to — show these on the consent screen.
    redirectHosts: string[]
    // Every redirect is a loopback address: any local process could be posing as this client.
    loopbackOnly: boolean
}

export interface GGOAuthInteraction {
    uid: string
    // "login": sign the user in (no login session, prompt=login or max_age).
    // "consent": the signed-in user approves a third-party client.
    prompt: "login" | "consent"
    // The login session's account, if there is one.
    accountId?: string
    client: GGOAuthInteractionClient
    scopes: string[]
    // The resource (API) the client asks for access to.
    resource: string
    // The authorization request's `extraParams`.
    params: Record<string, string>
}

// One request to the app's sign-in pages, under /oauth/interaction/:uid. Only reaches the app from the browser
// that started the flow (it holds the interaction cookie); a POST also came from the page's own origin.
export interface GGOAuthInteractionRequest {
    req: IncomingMessage
    res: ServerResponse
    interaction: GGOAuthInteraction
    // The path below /oauth/interaction/:uid ("" for the page itself).
    action: string
    method: "GET" | "POST"
    // The POST's form fields (application/x-www-form-urlencoded).
    form: Record<string, string>
    // Answer with a page, or send the browser on (303). Both send the headers sign-in pages need.
    html: (status: number, body: string) => void
    redirect: (url: string) => void
    // Each ends the request with a redirect back into the flow.
    login: (result: {accountId: string, amr?: string[]}) => Promise<void>
    // Grants what the client asked for. Only while prompt is "consent".
    consent: () => Promise<void>
    deny: () => Promise<void>
}

export interface GGOAuthServerOptions {
    // Public origin of the authorization server, no path (e.g. https://auth.example.com).
    issuer: () => string
    store: GGOAuthStore
    // Derives the cookie-signing key and the ES256 key of ID tokens. Rotating it signs everyone out
    // of the authorization server; issued access/refresh tokens are unaffected.
    secret: () => string
    // The first is the default for first-party clients; others default to the first one they may use.
    resources: [GGOAuthResource<any>, ...GGOAuthResource<any>[]]
    // The app's login and consent pages: it signs the user in (its own login session is the server's)
    // and finishes through the request's login/consent/deny.
    interactionPage: (request: GGOAuthInteractionRequest) => Promise<void>
    // HTML for the server's own error pages (an expired sign-in, an invalid request); plain text without.
    errorPage?: (message: string) => string
    // Authorization request parameters passed through to interactionPage (e.g. a sign-in method to start).
    extraParams?: string[]
    // Name of the login session cookie. Default: "__Host-session" on an https issuer.
    sessionCookie?: () => string
    // Pre-registered app clients: no consent screen, silent re-auth while the login session lives.
    // Read once, on first use (config isn't readable at compose time).
    firstPartyClients?: () => GGOAuthFirstPartyClient[]
    // Read once, on first use, like firstPartyClients.
    serviceClients?: () => GGOAuthServiceClientRegistration[]
    // Let any client self-register (RFC 7591).
    dynamicRegistration?: boolean
    // Accept clients identified by a metadata document URL (CIMD, what MCP clients prefer), fetched
    // only from https URLs on the default port under one of these prefixes (end each with "/"),
    // e.g. a vendor's hosted client documents: "https://claude.ai/oauth/".
    clientIdMetadataDocument?: {allowedUrlPrefixes: () => string[]}
    // Absolute refresh lifetime: rotation never extends it (OAuth for browser apps, RFC 10017).
    refreshTtlSec?: number
    sessionTtlSec?: number
    // Trust X-Forwarded-Proto (behind a TLS-terminating load balancer). X-Forwarded-Host is never
    // trusted: clients can send it through a load balancer that doesn't set it.
    proxy?: boolean
}

const BASE = "/oauth"
const AUTHORIZATION_PATH = `${BASE}/authorize`
const TOKEN_PATH = `${BASE}/token`
// Only the resources' access-token keys: what a resource server should trust. /oauth/jwks also lists
// the ID-token key, derived from `secret`, so trusting it would let that secret mint access tokens.
export const ACCESS_TOKEN_JWKS_PATH = `${BASE}/access-token-jwks`
const OIDC_SCOPES = ["openid", "offline_access"]
const INTERACTION_PATH = /^\/oauth\/interaction\/([\w-]+)(?:\/([\w-]+))?$/
const MAX_FORM_BYTES = 16 * 1024
// no-referrer would make browsers post `Origin: null`, which the interaction pages refuse.
const PAGE_HEADERS = {"content-type": "text/html; charset=utf-8", "referrer-policy": "same-origin", "cache-control": "no-store"}
const TICKET = "GGOAuthTicket"
// Not an oidc-provider model: when each grant last got tokens, for listGrants. Carries grantId, so revoking the grant removes it.
const GRANT_USAGE = "GrantUsage"
// Claims resolved during a refresh before the presented token was consumed (see rotateRefreshToken).
const prefetchedClaims = new WeakMap<object, {resource: string, claims: object}>()
// Comparing fixed-length HMAC digests keeps timingSafeEqual from leaking the secret's length.
const COMPARE_KEY = randomBytes(32)

const SERVICE_CLIENT = new GGContextKey<string>("ggOAuthServiceClient", IsString)
const SERVICE_CLIENT_HANDLER = GG_OAUTH_SERVICE_CLIENT.define((authenticate: (authorization: string | undefined) => string) => ({
    process: async () => {
        SERVICE_CLIENT.set(authenticate(GG_OAUTH_SERVICE_CLIENT.get()))
    },
}))

type Ticket = {uid: string, result: InteractionResults}

// OAuth 2.1 authorization server on a GGHttpServer. Protocol (PKCE, DCR, CIMD, resource indicators,
// RFC 9207 iss, refresh rotation + reuse revocation, revocation, discovery) is panva oidc-provider;
// this class owns the grest-ts seams: mounting, storage, token claims and the login/consent handoff.
export class GGOAuthServer {

    private _provider: Provider | undefined
    private _callback: ReturnType<Provider["callback"]> | undefined
    private _firstParty: Map<string, GGOAuthFirstPartyClient> | undefined
    private _service: Map<string, GGOAuthServiceClientRegistration> | undefined
    private readonly options: GGOAuthServerOptions
    private readonly resourceServer: GGOAuthResourceServer

    constructor(options: GGOAuthServerOptions) {
        // Resources sharing a signer are told apart only by audience: a token for one must never
        // verify as another's (e.g. an app's MCP token as the first-party API token).
        const audiences = options.resources.map(r => r.accessToken.audience)
        if (audiences.some(a => !a) || new Set(audiences).size !== audiences.length) {
            throw new Error("GGOAuthServer: every resource's accessToken needs its own audience")
        }
        this.options = options
        this.resourceServer = new GGOAuthResourceServer({authorizationServer: options.issuer, resources: options.resources})
    }

    private get firstParty(): Map<string, GGOAuthFirstPartyClient> {
        this._firstParty ??= new Map((this.options.firstPartyClients?.() ?? []).map(c => [c.clientId, c]))
        return this._firstParty
    }

    private get service(): Map<string, GGOAuthServiceClientRegistration> {
        this._service ??= new Map((this.options.serviceClients?.() ?? []).map(c => [c.clientId, c]))
        return this._service
    }

    // Where a client of this server sends the browser and redeems codes, on `origin` (default: the issuer).
    public endpoints(origin = this.options.issuer()): {authorization: string, token: string} {
        return {authorization: `${origin}${AUTHORIZATION_PATH}`, token: `${origin}${TOKEN_PATH}`}
    }

    public mount(server: GGHttpServer): void {
        const handle = async (req: IncomingMessage, res: ServerResponse) => {
            delete req.headers["x-forwarded-host"]
            const path = new URL(req.url ?? "/", "http://x").pathname
            if (path === ACCESS_TOKEN_JWKS_PATH && req.method === "GET") {
                res.writeHead(200, {"content-type": "application/jwk-set+json"})
                res.end(JSON.stringify({keys: await this.resourceJwks()}))
                return
            }
            const interaction = path.match(INTERACTION_PATH)
            if (interaction && (req.method === "GET" || req.method === "POST")) {
                res.setHeader("cache-control", "no-store")
                res.setHeader("x-frame-options", "DENY")
                res.setHeader("content-security-policy", "frame-ancestors 'none'")
                const [, uid, action = ""] = interaction
                if (action === "complete" && req.method === "GET") return this.finishInteraction(req, res, uid)
                return this.interactionPage(req, res, uid, action)
            }
            this._callback ??= this.provider().callback()
            await this._callback(req, res)
        }
        for (const method of ["GET", "POST"] as const) server.registerRoute(method, `${BASE}/*`, handle, "GGOAuthServer")
        server.registerRoute("GET", "/.well-known/openid-configuration", handle, "GGOAuthServer")
        server.registerRoute("GET", "/.well-known/oauth-authorization-server", handle, "GGOAuthServer")
        this.resourceServer.mount(server)
        SERVICE_CLIENT_HANDLER.create(this.authenticateServiceClient)
        new GGHttp(server).http(GGOAuthServiceApi, {token: this.serviceToken, exchange: this.exchange})

        server.announce(`${BASE}/`, "GGOAuthServer")
        server.announce("/.well-known/openid-configuration", "GGOAuthServer")
        server.announce("/.well-known/oauth-authorization-server", "GGOAuthServer")
    }

    // A resource the server issues for, served in this process (see GGOAuthResourceServer.protect).
    public protect<C extends object>(
        server: GGHttpServer,
        resource: GGOAuthResource<C>,
        path: string,
        handle: (req: IncomingMessage, res: ServerResponse, token: GGAccessPayload<C>) => Promise<void>,
    ): void {
        this.resourceServer.protect(server, resource, path, handle)
    }

    // Signs `accountId` in to the flow from outside it (e.g. a callback on another host): the browser that
    // started the flow must follow the returned URL.
    public loginTicketUrl = async (uid: string, accountId: string, amr?: string[]): Promise<string> =>
        this.ticket(await this.findInteraction(uid), {login: {accountId, amr, ts: Math.floor(Date.now() / 1000)}})

    // The flow's sign-in page, on the origin it started on: where a sign-in that failed on another host returns
    // to, with `error` (the app's own code) as ?error=.
    public interactionUrl = async (uid: string, error?: string): Promise<string> =>
        `${this.origin()}${BASE}/interaction/${(await this.findInteraction(uid)).uid}${error ? `?error=${encodeURIComponent(error)}` : ""}`

    // A sign-in that completes on an upstream whose callback is on another host (see GGOAuthExternalSignIn).
    // Its state cookie is signed with a key derived from `secret`.
    public externalSignIn = <D = undefined>(options: GGOAuthExternalSignInOptions): GGOAuthExternalSignIn<D> =>
        new GGOAuthExternalSignIn<D>(this, () => hkdf(this.options.secret(), "@grest-ts/oauth external sign-in"), options)

    public listGrants = async (subject: string): Promise<Array<{grantId: string, clientId: string, clientName: string, firstParty: boolean, createdAt: number, lastUsedAt?: number}>> => {
        const p = this.provider()
        const grants = await Promise.all((await this.options.store.listGrantIds(subject)).map(id => p.Grant.find(id)))
        return await Promise.all(grants
            .filter(g => g?.clientId && g.accountId === subject)
            .map(async g => {
                const [client, usage] = await Promise.all([
                    // A client metadata document may be unreachable; the grant must still be listed (and revocable).
                    p.Client.find(g!.clientId!).catch(() => undefined),
                    this.options.store.find(GRANT_USAGE, g!.jti),
                ])
                return {
                    grantId: g!.jti,
                    clientId: g!.clientId!,
                    clientName: String(client?.clientName ?? g!.clientId),
                    firstParty: this.firstParty.has(g!.clientId!),
                    createdAt: (g!.iat ?? 0) * 1000,
                    lastUsedAt: usage?.lastUsedAt as number | undefined,
                }
            }))
    }

    // Kills the grant's refresh tokens and codes now; already-issued access tokens live out their TTL.
    public revokeGrant = async (subject: string, grantId: string): Promise<void> => {
        const grant = await this.provider().Grant.find(grantId)
        if (!grant || grant.accountId !== subject) throw new NOT_FOUND()
        await this.options.store.revokeByGrantId(grantId)
        // A grant row isn't GRANT_BOUND, so revokeByGrantId leaves it.
        await this.options.store.destroy("Grant", grantId)
    }

    // "Log out everywhere": every grant and login session of the subject.
    public revokeAll = async (subject: string): Promise<void> => {
        const store = this.options.store
        await Promise.all([
            store.destroySessions(subject),
            store.listGrantIds(subject).then(ids => Promise.all(ids.map(id => Promise.all([store.revokeByGrantId(id), store.destroy("Grant", id)])))),
        ])
    }

    private async interactionPage(req: IncomingMessage, res: ServerResponse, uid: string, action: string): Promise<void> {
        const p = this.provider()
        const found = await p.interactionDetails(req, res).catch((err: unknown) => {
            if (err instanceof oidcErrors.SessionNotFound) return undefined
            throw err
        })
        if (found?.uid !== uid) return this.fail(res, 400, "This sign-in request has expired or was started in another browser. Start again from the app.")
        const method = req.method as "GET" | "POST"
        let form: Record<string, string> = {}
        if (method === "POST") {
            // The SameSite interaction cookie already keeps other sites out; this catches what it can't (a same-site page).
            // A browser's own same-origin flag also admits a flow served on another origin of the issuer (e.g. localhost).
            const site = req.headers["sec-fetch-site"]
            if (site ? site !== "same-origin" : req.headers.origin !== this.origin()) return this.fail(res, 403, "Request refused")
            const body = await readForm(req)
            if (!body) return this.fail(res, 403, "Request refused")
            form = body
        }
        const finish = (result: InteractionResults) => p.interactionFinished(req, res, result, {mergeWithLastSubmission: false})
        await this.options.interactionPage({
            req, res, action, method, form,
            html: (status, body) => {
                res.writeHead(status, PAGE_HEADERS)
                res.end(body)
            },
            redirect: (url) => {
                res.writeHead(303, {...PAGE_HEADERS, location: url})
                res.end()
            },
            interaction: await this.describeInteraction(found),
            login: ({accountId, amr}) => finish({login: {accountId, amr}}),
            consent: async () => {
                const accountId = found.session?.accountId
                if (found.prompt.name !== "consent" || !accountId) return this.fail(res, 400, "Sign in first")
                const existing = found.grantId ? await p.Grant.find(found.grantId) : undefined
                const grant = existing?.accountId === accountId ? existing : new p.Grant({accountId, clientId: String(found.params.client_id)})
                this.grantRequested(grant, found.params)
                await p.interactionFinished(req, res, {consent: {grantId: await grant.save()}}, {mergeWithLastSubmission: true})
            },
            deny: () => finish({error: "access_denied", error_description: "The user denied the request"}),
        })
    }

    private async describeInteraction(interaction: InstanceType<Provider["Interaction"]>): Promise<GGOAuthInteraction> {
        const clientId = String(interaction.params.client_id)
        const client = await this.provider().Client.find(clientId)
        if (!client) throw new NOT_FOUND({debugMessage: "Unknown OAuth client"})
        const hosts = [...new Set((client.redirectUris ?? []).map(u => new URL(u).host))]
        const extra = this.options.extraParams ?? []
        return {
            uid: interaction.uid,
            prompt: interaction.prompt.name === "consent" ? "consent" : "login",
            accountId: interaction.session?.accountId,
            client: {
                clientId,
                name: this.firstParty.get(clientId)?.name ?? String(client.clientName ?? clientId),
                firstParty: this.firstParty.has(clientId),
                redirectHosts: hosts,
                loopbackOnly: hosts.length > 0 && hosts.every(h => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h)),
            },
            scopes: requestedScopes(interaction.params),
            resource: this.requestedResource(interaction.params, clientId).resource(),
            params: Object.fromEntries(extra.filter(k => typeof interaction.params[k] === "string").map(k => [k, String(interaction.params[k])])),
        }
    }

    private origin(): string {
        return new URL(this.options.issuer()).origin
    }

    private fail(res: ServerResponse, status: number, message: string): void {
        const html = this.options.errorPage?.(message)
        res.writeHead(status, {"content-type": html ? "text/html; charset=utf-8" : "text/plain"})
        res.end(html ?? message)
    }

    private async findInteraction(uid: string): Promise<InstanceType<Provider["Interaction"]>> {
        const interaction = await this.provider().Interaction.find(uid)
        if (!interaction) throw new NOT_FOUND({debugMessage: "Unknown or expired OAuth interaction"})
        return interaction
    }

    // The result is applied only when the browser that started the flow (it holds the interaction
    // cookie) follows the redirect: a user approving someone else's flow can't hand them a code.
    private async ticket(interaction: InstanceType<Provider["Interaction"]>, result: InteractionResults): Promise<string> {
        const uid = interaction.uid
        const id = randomBytes(24).toString("base64url")
        await this.options.store.upsert(TICKET, id, {uid, result} satisfies Ticket, 120)
        return `${this.origin()}${BASE}/interaction/${uid}/complete?ticket=${id}`
    }

    private async finishInteraction(req: IncomingMessage, res: ServerResponse, uid: string): Promise<void> {
        const id = new URL(req.url ?? "/", "http://x").searchParams.get("ticket") ?? ""
        const ticket = id ? await this.takeTicket(id) : undefined
        if (!ticket || ticket.uid !== uid) return this.fail(res, 400, "Invalid or expired sign-in link")
        try {
            await this.provider().interactionFinished(req, res, ticket.result, {mergeWithLastSubmission: false})
        } catch (err) {
            if (!(err instanceof oidcErrors.SessionNotFound)) throw err
            this.fail(res, 400, "This sign-in was started in another browser")
        }
    }

    // consume is the store's atomic once-only mark: of two concurrent redemptions only one gets past it.
    private async takeTicket(id: string): Promise<Ticket | undefined> {
        const store = this.options.store
        try {
            await store.consume(TICKET, id)
        } catch (err) {
            if (err instanceof oidcErrors.InvalidGrant) return undefined
            throw err
        }
        const ticket = await store.find(TICKET, id) as Ticket | undefined
        await store.destroy(TICKET, id)
        return ticket
    }

    private grantRequested(grant: InstanceType<Provider["Grant"]>, params: Record<string, unknown>): void {
        const requested = requestedScopes(params)
        const oidc = requested.filter(s => OIDC_SCOPES.includes(s))
        if (oidc.length) grant.addOIDCScope(oidc.join(" "))
        const resource = this.requestedResource(params, String(grant.clientId))
        const resourceScopes = requested.filter(s => resource.scopes.includes(s))
        if (resourceScopes.length) grant.addResourceScope(resource.resource(), resourceScopes.join(" "))
    }

    private requestedResource(params: Record<string, unknown>, clientId: string): GGOAuthResource<any> {
        const indicator = typeof params.resource === "string" ? params.resource : undefined
        return (indicator && this.resource(indicator)) || this.defaultResource(clientId)
    }

    private resource(indicator: string | undefined): GGOAuthResource<any> | undefined {
        return this.options.resources.find(r => r.resource() === indicator)
    }

    private clientOf(ctx: KoaContextWithOIDC): {clientId: string, name: string} {
        const client = ctx.oidc.client!
        return {clientId: client.clientId, name: this.firstParty.get(client.clientId)?.name ?? String(client.clientName ?? client.clientId)}
    }

    private usableResource(indicator: string, clientId: string): GGOAuthResource<any> {
        const resource = this.resource(indicator)
        if (!resource) throw new oidcErrors.InvalidTarget()
        if (!this.mayUse(resource, clientId)) throw new oidcErrors.InvalidTarget("resource not available to this client")
        return resource
    }

    private defaultResource(clientId: string): GGOAuthResource<any> {
        return this.options.resources.find(r => this.mayUse(r, clientId)) ?? this.options.resources[0]
    }

    private mayUse(resource: GGOAuthResource<any>, clientId: string): boolean {
        const clients = resource.clients ?? "any"
        return clients === "any" || (clients === "firstParty" && this.firstParty.has(clientId))
    }

    // oidc-provider can only sign with key material it holds, and the resource's signer may hold none
    // (KMS). It signs with a per-process placeholder key; the claims are re-signed here before the token
    // leaves. A placeholder-signed token that escaped any other way verifies nowhere.
    private async resign(token: string): Promise<string> {
        const claims = decodeJwt(token)
        const resource = this.options.resources.find(r => r.accessToken.audience === claims["aud"])
        if (!resource) throw new Error("GGOAuthServer: issued an access token for an unknown audience")
        return resource.accessToken.signer.sign(claims)
    }

    private authenticateServiceClient = (authorization: string | undefined): string => {
        const [scheme, encoded] = (authorization ?? "").split(" ")
        const [id, secret] = Buffer.from(encoded ?? "", "base64").toString().split(":").map(safeDecode)
        const client = scheme?.toLowerCase() === "basic" && id ? this.service.get(id) : undefined
        const expected = client?.secret()
        if (!client || !expected || !equalSecrets(secret ?? "", expected)) throw new NOT_AUTHORIZED({debugMessage: "Unknown service client or wrong secret"})
        return client.clientId
    }

    // The client is the subject: only for resources reserved to service clients.
    private serviceToken = async ({resource}: {resource: string}): Promise<GGAccessTokenData> => {
        const clientId = SERVICE_CLIENT.get()!
        const target = this.resource(resource)
        if (target?.clients !== "service") throw new FORBIDDEN({debugMessage: "Resource is not available to service clients"})
        const claims = await target.claims(clientId, {clientId, name: clientId})
        if (!claims) throw new FORBIDDEN({debugMessage: "No token for this client"})
        return await target.accessToken.issue(clientId, claims)
    }

    // Same subject, no actor: the service asks on the subject's behalf with the subject's own token.
    private exchange = async ({subjectToken, resource, params}: {subjectToken: string, resource: string, params: Record<string, string>}): Promise<GGAccessTokenData> => {
        const target = this.resource(resource)
        if (!target?.exchange) throw new FORBIDDEN({debugMessage: "Resource is not issuable by exchange"})
        const subject = await target.exchange.from.verify(subjectToken).catch((err: unknown) => {
            if (err instanceof NOT_AUTHORIZED) return undefined
            throw err
        })
        if (!subject) throw new SUBJECT_TOKEN_INVALID()
        const declared = Object.fromEntries((target.exchange.params ?? []).map(name => [name, params[name]]))
        const claims = await target.exchange.claims(subject.sub, declared)
        if (!claims) throw new FORBIDDEN({debugMessage: "No token for this subject"})
        return await target.accessToken.issue(subject.sub, claims, {authTime: subject.auth_time})
    }

    private ttlOf(indicator: string | undefined): number {
        const resource = this.resource(indicator)
        return resource ? Math.floor(resource.accessToken.accessTtlMs / 1000) : 600
    }

    private async resourceJwks(): Promise<object[]> {
        const all = (await Promise.all(this.options.resources.map(r => r.accessToken.signer.publicJwks?.() ?? []))).flat()
        return [...new Map(all.map(k => [k.kid ?? JSON.stringify(k), k])).values()]
    }

    private provider(): Provider {
        if (this._provider) return this._provider
        const o = this.options
        const refreshTtlSec = o.refreshTtlSec ?? 30 * 24 * 3600
        const firstParty = this.firstParty
        const placeholderKey = randomBytes(32)

        const config: Configuration = {
            adapter: toOidcAdapter(o.store),
            jwks: {keys: [deriveEs256Jwk(o.secret())]},
            cookies: {
                keys: [hkdf(o.secret(), "@grest-ts/oauth cookies").toString("base64url")],
                names: {session: o.sessionCookie?.() ?? (new URL(o.issuer()).protocol === "https:" ? "__Host-session" : "_session")},
            },
            clients: [...firstParty.values()].map(c => ({
                client_id: c.clientId,
                client_name: c.name,
                redirect_uris: c.redirectUris,
                post_logout_redirect_uris: c.postLogoutRedirectUris ?? [],
                token_endpoint_auth_method: "none",
                grant_types: c.refreshTokens === false ? ["authorization_code"] : ["authorization_code", "refresh_token"],
                response_types: ["code"],
                application_type: "web",
            }) satisfies ClientMetadata),
            clientDefaults: {
                grant_types: ["authorization_code", "refresh_token"],
                response_types: ["code"],
                token_endpoint_auth_method: "none",
                id_token_signed_response_alg: "ES256",
                // Undeclared = native: CLI clients (e.g. Claude Code's metadata document) redirect to a
                // loopback address on a per-run port, which oidc-provider only port-matches for native.
                application_type: "native",
            },
            routes: {
                authorization: AUTHORIZATION_PATH, token: TOKEN_PATH, registration: `${BASE}/register`,
                jwks: `${BASE}/jwks`, revocation: `${BASE}/revoke`, end_session: `${BASE}/logout`, userinfo: `${BASE}/userinfo`,
                introspection: `${BASE}/introspect`, pushed_authorization_request: `${BASE}/par`, code_verification: `${BASE}/device`,
                device_authorization: `${BASE}/device/auth`, backchannel_authentication: `${BASE}/backchannel`, challenge: `${BASE}/challenge`,
            },
            interactions: {url: (_ctx, interaction) => `${BASE}/interaction/${interaction.uid}`},
            extraParams: o.extraParams ?? [],
            scopes: OIDC_SCOPES,
            responseTypes: ["code"],
            pkce: {required: () => true},
            features: {
                devInteractions: {enabled: false},
                revocation: {enabled: true},
                registration: {enabled: !!o.dynamicRegistration},
                ...(o.clientIdMetadataDocument ? {clientIdMetadataDocument: {
                    enabled: true,
                    ack: "draft-02",
                    allowFetch: async (_ctx: unknown, clientId: string) => isAllowedDocumentUrl(clientId, o.clientIdMetadataDocument!.allowedUrlPrefixes()),
                }} : {}),
                rpInitiatedLogout: {
                    enabled: true,
                    // Skip the provider's "do you want to sign out?" page. `logout=yes` is that page's
                    // button value: without it only the requesting client is signed out, not the session.
                    logoutSource: async (ctx, form) => {
                        if (!form.includes("</form>")) throw new Error("GGOAuthServer: oidc-provider's logout form changed; can't confirm logout")
                        // Any page can link here; only a first-party client's own page (its redirect origin as
                        // Referer) skips the confirmation click.
                        const client = ctx.oidc.client && firstParty.get(ctx.oidc.client.clientId)
                        const referer = URL.parse(ctx.get("referer"))?.origin
                        if (client && referer && client.redirectUris.some(u => new URL(u).origin === referer)) {
                            const confirmed = form.replace("</form>", `<input type="hidden" name="logout" value="yes"/></form>`)
                            ctx.body = `<!DOCTYPE html><html><body>${confirmed}<script>document.forms[0].submit()</script></body></html>`
                            return
                        }
                        ctx.body = `<!DOCTYPE html><html><body>${form.replace("</form>", `<button name="logout" value="yes">Sign out</button></form>`)}</body></html>`
                    },
                },
                resourceIndicators: {
                    enabled: true,
                    defaultResource: (_ctx, client) => this.defaultResource(client.clientId).resource(),
                    useGrantedResource: () => true,
                    getResourceServerInfo: (ctx, indicator, client) => {
                        const resource = this.usableResource(indicator, client.clientId)
                        return {
                            scope: resource.scopes.join(" "),
                            audience: resource.accessToken.audience ?? indicator,
                            accessTokenTTL: Math.floor(resource.accessToken.accessTtlMs / 1000),
                            accessTokenFormat: "jwt",
                            // Placeholder: the token endpoint re-signs every access token with the resource's own signer.
                            jwt: {sign: {alg: "HS256", key: placeholderKey}},
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
            // Only first-party sign-ins end with the login session: signing out of the app must not
            // disconnect the other apps the user connected (revoked explicitly instead).
            expiresWithSession: async (ctx) => firstParty.has(ctx.oidc.client!.clientId),
            // Runs before the presented refresh token is consumed. Resolve the claims here, so a failure
            // (store/IdP down) leaves it redeemable — after consumption, the client's retry is reuse and
            // revokes the grant.
            rotateRefreshToken: async (ctx) => {
                const rt = ctx.oidc.entities.RefreshToken!
                const clientId = String(rt.clientId)
                // Which resource the new access token will be for, as oidc-provider resolves it (the
                // request's resource first, then the granted one), validated now rather than after consume.
                const granted = [rt.resource ?? []].flat() as string[]
                const requested = ctx.oidc.params?.resource
                if (typeof requested === "string" && !granted.includes(requested)) throw new oidcErrors.InvalidTarget()
                const indicator = typeof requested === "string" ? requested : granted.length === 1 ? granted[0] : undefined
                const resource = indicator ? this.usableResource(indicator, clientId) : this.defaultResource(clientId)
                const claims = await resource.claims(String(rt.accountId), this.clientOf(ctx))
                if (!claims) throw new oidcErrors.InvalidGrant("subject is no longer valid")
                prefetchedClaims.set(ctx, {resource: resource.resource(), claims})
                return true
            },
            extraTokenClaims: async (_ctx: KoaContextWithOIDC, token) => {
                if (token.kind !== "AccessToken" && token.kind !== "ClientCredentials") return undefined
                const at = token as InstanceType<Provider["AccessToken"]>
                const resource = this.resource(at.resourceServer?.identifier())
                if (!resource) return undefined
                const subject = token.kind === "ClientCredentials" ? String(at.clientId) : String(at.accountId)
                const prefetched = prefetchedClaims.get(_ctx)
                const claims = prefetched?.resource === resource.resource() ? prefetched.claims : await resource.claims(subject, this.clientOf(_ctx))
                if (!claims) throw new oidcErrors.InvalidGrant("subject is no longer valid")
                // On refresh, the sign-in time the refresh token copied from its code: a refresh never makes a token fresh.
                const authTime = (_ctx.oidc.entities.AuthorizationCode ?? _ctx.oidc.entities.RefreshToken)?.authTime
                return {data: resource.accessToken.encodeClaims(claims), auth_time: authTime}
            },
            findAccount: async (_ctx, sub) => ({accountId: sub, claims: async () => ({sub})}),
            ttl: {
                AccessToken: (_ctx, token) => this.ttlOf(token.resourceServer?.identifier()),
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
                const message = `${out.error}: ${out.error_description ?? ""}`
                const html = o.errorPage?.(message)
                ctx.type = html ? "html" : "text/plain"
                ctx.body = html ?? message
            },
        }
        const provider = new Provider(o.issuer(), config)
        provider.proxy = !!o.proxy
        // Resource scopes aren't OIDC scopes, so the provider leaves them out of its metadata.
        provider.use(async (ctx, next) => {
            await next()
            if (ctx.oidc?.route === "discovery") (ctx.body as {scopes_supported: string[]}).scopes_supported = [...OIDC_SCOPES, ...new Set(o.resources.flatMap(r => r.scopes))]
            // A new body: oidc-provider reuses its own between requests.
            if (ctx.oidc?.route === "jwks") ctx.body = {keys: [...(ctx.body as {keys: object[]}).keys, ...await this.resourceJwks()]}
            const body = ctx.body as {access_token?: unknown} | undefined
            if (ctx.oidc?.route === "token" && typeof body?.access_token === "string") body.access_token = await this.resign(body.access_token)
        })
        provider.use(async (ctx, next) => {
            await next()
            if (ctx.oidc?.route !== "token" || ctx.status !== 200) return
            const grant = ctx.oidc.entities.Grant
            if (!grant) return
            // The tokens are already issued (a refresh token already rotated): failing now would strand the client.
            await o.store.upsert(GRANT_USAGE, grant.jti, {grantId: grant.jti, lastUsedAt: Date.now()}, Math.max(1, grant.remainingTTL))
                .catch(error => GGLog.error(this, "Recording grant usage failed", {error}))
        })
        this._provider = provider
        return provider
    }
}

function isAllowedDocumentUrl(clientId: string, prefixes: string[]): boolean {
    const url = URL.parse(clientId)
    if (!url || url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false
    return prefixes.some(prefix => (url.origin + url.pathname).startsWith(prefix))
}

function requestedScopes(params: Record<string, unknown>): string[] {
    return String(params.scope ?? "").split(" ").filter(Boolean)
}

function safeDecode(value: string): string | undefined {
    try {
        return decodeURIComponent(value)
    } catch {
        return undefined
    }
}

function equalSecrets(a: string, b: string): boolean {
    return timingSafeEqual(createHmac("sha256", COMPARE_KEY).update(a).digest(), createHmac("sha256", COMPARE_KEY).update(b).digest())
}

function hkdf(secret: string, info: string): Buffer {
    return Buffer.from(hkdfSync("sha256", secret, "", info, 32))
}

// Deterministic, so every instance publishes the same key without distributing a key file.
export function deriveEs256Jwk(secret: string) {
    const d = hkdf(secret, "@grest-ts/oauth es256")
    const ecdh = createECDH("prime256v1")
    ecdh.setPrivateKey(d)
    const point = ecdh.getPublicKey()
    const x = point.subarray(1, 33).toString("base64url")
    const y = point.subarray(33).toString("base64url")
    const kid = createHash("sha256").update(x + y).digest("base64url").slice(0, 16)
    return {kty: "EC", crv: "P-256", d: d.toString("base64url"), x, y, alg: "ES256", use: "sig", kid}
}

async function readForm(req: IncomingMessage): Promise<Record<string, string> | undefined> {
    if (!(req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) return undefined
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req as AsyncIterable<Buffer>) {
        size += chunk.length
        if (size > MAX_FORM_BYTES) return undefined
        chunks.push(chunk)
    }
    return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()))
}
