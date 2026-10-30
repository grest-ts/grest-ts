import {GG_DISCOVERY} from "@grest-ts/discovery"
import {GG_OAUTH_SERVICE_CLIENT, GGOAuthServiceApi} from "./GGOAuthServiceApi"
import {ACCESS_TOKEN_JWKS_PATH} from "./GGOAuthServer"

export interface GGOAuthServiceClientOptions {
    clientId: string
    secret: () => string
    // The authorization server's base URL, read on first use. Empty or unset: service discovery.
    url?: () => string
    now?: () => number
}

// A reused token is replaced this long before it expires, so it never expires in flight.
const REFRESH_MARGIN_MS = 60_000

// A backend of the app calling the authorization server's GGOAuthServiceApi as a registered service
// client (see GGOAuthServer serviceClients): tokens for its own calls, and token exchange.
export class GGOAuthServiceClient {

    private readonly options: GGOAuthServiceClientOptions
    private readonly now: () => number
    private readonly tokens = new Map<string, {pending: Promise<{token: string, expiresAt: number}>, expiresAt?: number}>()
    private _api: ReturnType<typeof GGOAuthServiceApi.createClient> | undefined

    constructor(options: GGOAuthServiceClientOptions) {
        this.options = options
        this.now = options.now ?? Date.now
    }

    // A token for `resource`, reused until shortly before it expires.
    public token = async (resource: string): Promise<string> => await this.cachedToken(resource)

    // On the prototype so the testkit can drop tokens between tests.
    // Concurrent callers share one request: the entry is set before the first await.
    private async cachedToken(resource: string): Promise<string> {
        const held = this.tokens.get(resource)
        if (held && (held.expiresAt === undefined || held.expiresAt - REFRESH_MARGIN_MS > this.now())) return (await held.pending).token
        const entry: {pending: Promise<{token: string, expiresAt: number}>, expiresAt?: number} = {pending: (async () => await this.api.token({resource}))()}
        this.tokens.set(resource, entry)
        entry.pending.then(
            t => { entry.expiresAt = t.expiresAt },
            () => { if (this.tokens.get(resource) === entry) this.tokens.delete(resource) },
        )
        return (await entry.pending).token
    }

    // Trades `subjectToken` (an access token) for one for `resource`, same subject.
    public exchange = async (subjectToken: string, resource: string, params: Record<string, string> = {}): Promise<{token: string, expiresAt: number}> =>
        await this.api.exchange({subjectToken, resource, params})

    private get api(): ReturnType<typeof GGOAuthServiceApi.createClient> {
        if (this._api) return this._api
        const url = this.options.url?.()
        const basic = () => `Basic ${Buffer.from(`${encodeURIComponent(this.options.clientId)}:${encodeURIComponent(this.options.secret())}`).toString("base64")}`
        this._api = GGOAuthServiceApi.createClient({...(url ? {url} : {}), wires: [{wire: GG_OAUTH_SERVICE_CLIENT, value: basic}]})
        return this._api
    }
}

// For JwksVerifier's `jwks`: the authorization server's access-token keys, at `url` or, when it's empty
// or unset, on the server discovery gives GGOAuthServiceApi.
export function accessTokenJwksUrl(url?: () => string): () => Promise<string> {
    return async () => `${url?.() || new URL(await GG_DISCOVERY.get().discoverApi(GGOAuthServiceApi.name)).origin}${ACCESS_TOKEN_JWKS_PATH}`
}
