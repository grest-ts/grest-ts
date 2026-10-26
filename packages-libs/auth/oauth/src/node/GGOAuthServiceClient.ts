import {ACCESS_TOKEN_TYPE, TOKEN_EXCHANGE} from "./tokenExchange"

export interface GGOAuthServiceClientOptions {
    // The authorization server's token endpoint; resolved per call (config, service discovery).
    tokenEndpoint: () => string | Promise<string>
    clientId: string
    secret: () => string
    now?: () => number
}

// An error response from the token endpoint (RFC 6749 §5.2), e.g. `invalid_grant`.
export class GGOAuthTokenError extends Error {
    public readonly error: string
    public readonly status: number

    constructor(error: string, status: number, description?: string) {
        super(`${error}${description ? `: ${description}` : ""}`)
        this.error = error
        this.status = status
    }
}

// A reused token is replaced this long before it expires, so it never expires in flight.
const REFRESH_MARGIN_MS = 60_000

// A backend of the app talking to the authorization server as a service client (see
// GGOAuthServer serviceClients): client_credentials for its own calls, and token exchange.
export class GGOAuthServiceClient {

    private readonly options: GGOAuthServiceClientOptions
    private readonly now: () => number
    private readonly tokens = new Map<string, {pending: Promise<{token: string, expiresAt: number}>, expiresAt?: number}>()

    constructor(options: GGOAuthServiceClientOptions) {
        this.options = options
        this.now = options.now ?? Date.now
    }

    // client_credentials for `resource`. One token per resource is reused until shortly before it expires.
    // Concurrent callers share one request: the entry is set before the first await.
    public token = async (resource: string): Promise<string> => {
        const held = this.tokens.get(resource)
        if (held && (held.expiresAt === undefined || held.expiresAt - REFRESH_MARGIN_MS > this.now())) return (await held.pending).token
        const entry: {pending: Promise<{token: string, expiresAt: number}>, expiresAt?: number} = {pending: this.request({grant_type: "client_credentials", resource})}
        this.tokens.set(resource, entry)
        entry.pending.then(
            t => { entry.expiresAt = t.expiresAt },
            () => { if (this.tokens.get(resource) === entry) this.tokens.delete(resource) },
        )
        return (await entry.pending).token
    }

    // RFC 8693: trades `subjectToken` (an access token) for one for `resource`, same subject.
    public exchange = async (subjectToken: string, resource: string, params: Record<string, string> = {}): Promise<{token: string, expiresAt: number}> =>
        this.request({grant_type: TOKEN_EXCHANGE, subject_token: subjectToken, subject_token_type: ACCESS_TOKEN_TYPE, resource, ...params})

    private async request(body: Record<string, string>): Promise<{token: string, expiresAt: number}> {
        const basic = Buffer.from(`${encodeURIComponent(this.options.clientId)}:${encodeURIComponent(this.options.secret())}`).toString("base64")
        const res = await fetch(await this.options.tokenEndpoint(), {
            method: "POST",
            headers: {authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded"},
            body: new URLSearchParams(body),
        })
        const json = await res.json().catch(() => ({})) as {access_token?: string, expires_in?: number, error?: string, error_description?: string}
        if (!res.ok || !json.access_token) throw new GGOAuthTokenError(json.error ?? "server_error", res.status, json.error_description)
        return {token: json.access_token, expiresAt: this.now() + (json.expires_in ?? 0) * 1000}
    }
}
