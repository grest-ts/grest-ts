import type {IncomingMessage, ServerResponse} from "node:http"
import type {GGHttpServer} from "@grest-ts/http"
import type {GGAccessPayload, GGAuthAccessToken, TokenVerifier} from "@grest-ts/auth"
import {RESOURCE_METADATA, resourceMetadataPath, resourceMetadataUrl} from "../shared/resourceMetadata"

// An API that accepts the authorization server's tokens. It verifies them and holds no AS state.
export interface GGOAuthProtectedResource<C extends object> {
    // Absolute URL identifying the API; for an MCP server, its URL exactly as users enter it.
    resource: () => string
    // Verifies this resource's tokens (audience, issuer, signature).
    accessToken: GGAuthAccessToken<C, TokenVerifier>
    scopes: [string, ...string[]]
}

export interface GGOAuthResourceServerOptions {
    // The authorization server clients are sent to (its issuer URL).
    authorizationServer: () => string
    resources: GGOAuthProtectedResource<any>[]
}

// The resource-server half of OAuth: RFC 9728 metadata for each resource, and `protect` for routes
// that must answer an invalid token with the discovery challenge. Runs with or without the
// authorization server in the same process.
export class GGOAuthResourceServer {

    private readonly options: GGOAuthResourceServerOptions

    constructor(options: GGOAuthResourceServerOptions) {
        this.options = options
    }

    public mount(server: GGHttpServer): void {
        server.registerRoute("GET", RESOURCE_METADATA, this.resourceMetadata, "GGOAuthResourceServer")
        server.registerRoute("GET", `${RESOURCE_METADATA}/*`, this.resourceMetadata, "GGOAuthResourceServer")
        server.announce(RESOURCE_METADATA, "GGOAuthResourceServer")
    }

    // Requests without a valid token for `resource` get 401 + `WWW-Authenticate: Bearer
    // resource_metadata=…`, the discovery handshake MCP clients run before signing in.
    public protect<C extends object>(
        server: GGHttpServer,
        resource: GGOAuthProtectedResource<C>,
        path: string,
        handle: (req: IncomingMessage, res: ServerResponse, token: GGAccessPayload<C>) => Promise<void>,
    ): void {
        const guarded = async (req: IncomingMessage, res: ServerResponse) => {
            const auth = req.headers.authorization
            const token = auth?.toLowerCase().startsWith("bearer ")
                ? await resource.accessToken.verify(auth.slice(7)).catch(() => undefined)
                : undefined
            if (!token) {
                res.writeHead(401, {
                    "www-authenticate": `Bearer resource_metadata="${resourceMetadataUrl(resource.resource())}", scope="${resource.scopes.join(" ")}"${auth ? `, error="invalid_token"` : ""}`,
                })
                res.end()
                return
            }
            await handle(req, res, token)
        }
        for (const method of ["GET", "POST", "DELETE"] as const) server.registerRoute(method, path, guarded, "GGOAuthResourceServer")
        server.announce(path, "GGOAuthResourceServer")
    }

    private resourceMetadata = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        const path = new URL(req.url ?? "/", "http://x").pathname
        const resource = this.options.resources.find(r => resourceMetadataPath(r.resource()) === path)
        if (!resource) {
            res.writeHead(404)
            res.end()
            return
        }
        res.writeHead(200, {"content-type": "application/json"})
        res.end(JSON.stringify({
            resource: resource.resource(),
            authorization_servers: [this.options.authorizationServer()],
            scopes_supported: resource.scopes,
            bearer_methods_supported: ["header"],
        }))
    }
}
