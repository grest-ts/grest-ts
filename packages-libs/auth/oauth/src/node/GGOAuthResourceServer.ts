import type {IncomingMessage, ServerResponse} from "node:http"
import {decodeJwt} from "jose"
import type {GGHttpServer} from "@grest-ts/http"
import {SERVER_ERROR} from "@grest-ts/schema"
import type {GGAccessPayload, GGAuthAccessToken, TokenVerifier} from "@grest-ts/auth"
import {RESOURCE_METADATA, resourceMetadataUrl} from "../shared/resourceMetadata"

// An API that accepts the authorization server's tokens. It verifies them and holds no AS state.
export interface GGOAuthProtectedResource<C extends object> {
    // Absolute URL identifying the API; for an MCP server, its URL exactly as users enter it.
    resource: () => string
    // Verifies this resource's tokens (audience, issuer, signature).
    accessToken: GGAuthAccessToken<C, TokenVerifier>
    scopes: [string, ...string[]]
}

export interface GGOAuthResourceServerOptions<R extends GGOAuthProtectedResource<any> = GGOAuthProtectedResource<any>> {
    // The authorization server clients are sent to (its issuer URL).
    authorizationServer: () => string
    resources: R[]
}

// The resource-server half of OAuth: RFC 9728 metadata for each resource, and `protect` for routes
// that must answer an invalid token with the discovery challenge. Runs with or without the
// authorization server in the same process.
export class GGOAuthResourceServer<R extends GGOAuthProtectedResource<any> = GGOAuthProtectedResource<any>> {

    private readonly options: GGOAuthResourceServerOptions<R>
    private readonly served = new Set<GGOAuthProtectedResource<any>>()

    constructor(options: GGOAuthResourceServerOptions<R>) {
        this.options = options
    }

    public mount(server: GGHttpServer): void {
        server.registerRoute("GET", RESOURCE_METADATA, this.resourceMetadata, "GGOAuthResourceServer")
        server.registerRoute("GET", `${RESOURCE_METADATA}/*`, this.resourceMetadata, "GGOAuthResourceServer")
        server.announce(RESOURCE_METADATA, "GGOAuthResourceServer")
    }

    // Serves `path` (the resource URL's path) and everything under it: each URL is a resource of its own (e.g.
    // /mcp/<label>, so a client can add it more than once) and takes only tokens issued for exactly that URL.
    // Requests without a valid token for `resource` get 401 + `WWW-Authenticate: Bearer
    // resource_metadata=…`, the discovery handshake MCP clients run before signing in.
    public protect<C extends object>(
        server: GGHttpServer,
        resource: GGOAuthProtectedResource<C>,
        path: string,
        handle: (req: IncomingMessage, res: ServerResponse, token: GGAccessPayload<C>) => Promise<void>,
    ): void {
        this.served.add(resource)
        const guarded = async (req: IncomingMessage, res: ServerResponse) => {
            const url = new URL(new URL(req.url ?? "/", "http://x").pathname, resource.resource()).href
            const auth = req.headers.authorization
            const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7) : undefined
            let token: GGAccessPayload<C> | undefined
            try {
                token = bearer ? await resource.accessToken.verify(bearer) : undefined
            } catch (err) {
                // The keys can't be fetched: an invalid_token answer would send the client to sign in again.
                if (err instanceof SERVER_ERROR) {
                    res.writeHead(503)
                    res.end()
                    return
                }
            }
            if (!token || ![decodeJwt(bearer!).aud].flat().some(aud => URL.parse(String(aud))?.href === url)) {
                res.writeHead(401, {
                    "www-authenticate": `Bearer resource_metadata="${resourceMetadataUrl(url)}", scope="${resource.scopes.join(" ")}"${auth ? `, error="invalid_token"` : ""}`,
                })
                res.end()
                return
            }
            await handle(req, res, token)
        }
        for (const method of ["GET", "POST", "DELETE"] as const) {
            server.registerRoute(method, path, guarded, "GGOAuthResourceServer")
            server.registerRoute(method, `${path.replace(/\/$/, "")}/*`, guarded, "GGOAuthResourceServer")
        }
        server.announce(path, "GGOAuthResourceServer")
    }

    // What `url` is a resource of: a resource's own URL, or a plain URL (no query, fragment, `//`, `.` or `..`) under
    // one served by protect. The innermost one answers.
    public resourceAt(url: string): R | undefined {
        const resources = this.options.resources
        return resources.find(r => r.resource() === url) ?? (isPlainUrl(url)
            ? resources.filter(r => this.served.has(r) && `${url}/`.startsWith(`${r.resource().replace(/\/$/, "")}/`)).sort((a, b) => b.resource().length - a.resource().length)[0]
            : undefined)
    }

    // Served by the URL's path on any host: the resource whose own origin gives a URL it answers for.
    private resourceMetadata = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        const path = new URL(req.url ?? "/", "http://x").pathname.slice(RESOURCE_METADATA.length)
        const url = this.options.resources.map(r => new URL(r.resource()).origin + path).find(u => this.resourceAt(u))
        const resource = url && this.resourceAt(url)
        if (!resource) {
            res.writeHead(404)
            res.end()
            return
        }
        res.writeHead(200, {"content-type": "application/json"})
        res.end(JSON.stringify({
            resource: url,
            authorization_servers: [this.options.authorizationServer()],
            scopes_supported: resource.scopes,
            bearer_methods_supported: ["header"],
        }))
    }
}

function isPlainUrl(url: string): boolean {
    const parsed = URL.parse(url)
    return !!parsed && !/[?#]/.test(url) && !parsed.pathname.includes("//") && (url === parsed.origin || url === parsed.origin + parsed.pathname)
}
