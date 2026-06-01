import http from "http";
import https from "https";
import {HttpMethod, HttpStatusCode} from "@grest-ts/common";
import {GGLocator, GGLocatorKey, GGLocatorScope, GGLocatorServiceType} from "@grest-ts/locator";
import {GG_HTTP_SERVER} from "./GG_HTTP_SERVER";
import {GGLog} from "@grest-ts/logger";
import findMyWay, {HTTPMethod} from "find-my-way";
import type {GGHttpSchema} from "../schema/GGHttpSchema";
import {GGWireContextKey} from "../schema/GGWireContextKey";
import "../schema/GGWireContextKey.node";
import {describePermission, GG_NO_PERMISSIONS, GGContractMethod, GGPermission} from "@grest-ts/schema";
// Forward declaration — actual type lives in @grest-ts/websocket to avoid circular dep.
// GGHttpServer only stores the array; callers cast as needed.
type AnyWebSocketSchema = {
    name: string;
    path: string;
    contract: {clientToServer: {methods: Record<string, GGContractMethod>}};
    middlewares: readonly unknown[];
    connectPermission?: GGPermission;
};

/** Smart wires of one registered schema (HTTP route set or WS contract). */
type WireSurface = {name: string; wires: GGWireContextKey[]};

export interface GGCorsConfig {
    /**
     * Allowed cross-origin origins. Either an exact-match list or a predicate.
     * Only a matching Origin is echoed back — an arbitrary origin is never
     * reflected (that would be a credential-leak / CSRF hole with credentials on).
     */
    origins: string[] | ((origin: string) => boolean);
    /**
     * When true, adds Access-Control-Allow-Credentials: true so the browser will
     * send/store cross-origin cookies. Requires an exact-origin echo (never `*`),
     * which this enforces by construction.
     */
    credentials?: boolean;
}

export interface GGHttpServerAdapterConfig {
    key?: GGLocatorKey<GGHttpServer>;
    port?: number;
    /**
     * Cross-origin policy. Omitted (default) keeps the permissive
     * `Access-Control-Allow-Origin: *` with no credentials — backward compatible.
     * When set, switches to allowlisted mode: only an Origin in `origins` is echoed
     * (never `*`), and `credentials: true` enables cross-origin cookies.
     */
    cors?: GGCorsConfig;
    /**
     * If provided, the server listens over HTTPS using this cert+key. Both
     * must be PEM-encoded strings or Buffers. Leaving undefined keeps the
     * default plain-HTTP listener. Useful for self-signed TLS on internal
     * endpoints where the caller pins the fingerprint; public-facing
     * services should typically still terminate TLS at a real edge (ALB,
     * Caddy, etc.) rather than provide certs here.
     */
    tls?: {
        cert: string | Buffer;
        key: string | Buffer;
    };
}

export class GGHttpServer {

    protected _port: number | undefined;
    protected teardownPromise: Promise<void> | undefined;
    protected readonly scope: GGLocatorScope;
    protected readonly runtimeName: string;
    private readonly configuredPort: number;
    private readonly cors?: GGCorsConfig;

    private readonly _onStart: Array<() => void> = [];
    private readonly _onTeardown: Array<() => void> = [];

    /**
     * Mutable during compose(); frozen and exposed as ReadonlyArray once the server starts.
     * Framework-internal — only setupRoutes() (in GGHttpSchema.startServer.ts) should push here.
     */
    private readonly _registeredSchemas: GGHttpSchema<any, any>[] = [];

    /**
     * All GGHttpSchema instances registered on this server, in registration order.
     * Available from the moment compose() begins; frozen (no further push allowed) once start() is called.
     */
    get registeredSchemas(): ReadonlyArray<GGHttpSchema<any, any>> {
        return this._registeredSchemas;
    }

    public readonly httpServer: http.Server;
    private activeRequests = 0;
    private router = findMyWay<findMyWay.HTTPVersion.V1>();

    private static readonly DEFAULT_CORS_HEADERS = ['Content-Type'];
    private readonly _corsHeaders = new Set<string>(GGHttpServer.DEFAULT_CORS_HEADERS);
    private _corsHeadersCache: string = GGHttpServer.DEFAULT_CORS_HEADERS.join(', ');

    private readonly _corsExposeHeaders = new Set<string>();
    private _corsExposeHeadersCache: string = '';

    constructor(config?: GGHttpServerAdapterConfig) {

        this.runtimeName = GGLocator.getScope().serviceName;
        this.scope = GGLocator.getScope();
        this.configuredPort = config?.port ?? (process.env.PORT ? Number(process.env.PORT) : 0);
        this.cors = config?.cors;

        GGLocator.getScope().setWithLifecycle(config?.key ?? GG_HTTP_SERVER, this, {
            type: GGLocatorServiceType.HTTP,
            start: this.start.bind(this),
            teardown: this.teardown.bind(this)
        });

        const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
            if (this.teardownPromise) {
                res.statusCode = HttpStatusCode.ServerTemporarilyNotAvailable503;
                res.end();
                return;
            }
            this.activeRequests++;
            try {
                const cors = corsResponseHeaders(req.headers.origin, this.cors, this._corsHeadersCache, this._corsExposeHeadersCache);
                for (const name in cors) res.setHeader(name, cors[name]);
                if (req.method === 'OPTIONS') {
                    res.writeHead(204);
                    res.end();
                } else {
                    const resolved = this.router.find(req.method as HTTPMethod, req.url)
                    if (resolved) {
                        await (resolved.handler as unknown as GGHttpRequestCallback)(req, res);
                    } else {
                        res.writeHead(404);
                        res.end();
                    }
                }
            } catch (error) {
                GGLog.error(this, error);
                res.writeHead(500);
                res.end();
            } finally {
                this.activeRequests--;
            }
        };

        this.httpServer = config?.tls
            ? https.createServer({cert: config.tls.cert, key: config.tls.key}, handler)
            : http.createServer(handler);
    }

    /**
     * Register custom header names for CORS Access-Control-Allow-Headers.
     * Called automatically during schema registration based on middleware declarations.
     */
    public registerCorsHeaders(headers: readonly string[]): void {
        let changed = false;
        for (const h of headers) {
            if (!this._corsHeaders.has(h)) {
                this._corsHeaders.add(h);
                changed = true;
            }
        }
        if (changed) {
            this._corsHeadersCache = Array.from(this._corsHeaders).join(', ');
        }
    }

    /**
     * Register custom header names for CORS Access-Control-Expose-Headers.
     * Called automatically during schema registration based on codec and middleware declarations.
     */
    public registerCorsExposeHeaders(headers: readonly string[]): void {
        let changed = false;
        for (const h of headers) {
            if (!this._corsExposeHeaders.has(h)) {
                this._corsExposeHeaders.add(h);
                changed = true;
            }
        }
        if (changed) {
            this._corsExposeHeadersCache = Array.from(this._corsExposeHeaders).join(', ');
        }
    }

    /**
     * Current port the server is listening to.
     * May be undefined before start() is called.
     */
    get port(): number | undefined {
        return this._port;
    }

    // =========================================================================
    // Common implementation
    // =========================================================================

    /** @internal Called by setupRoutes() during compose(). Do not call directly. */
    public _registerSchema(schema: GGHttpSchema<any, any>): void {
        this._registeredSchemas.push(schema);
    }

    private readonly _registeredWebSocketSchemas: AnyWebSocketSchema[] = [];

    /**
     * All GGWebSocketSchema instances registered on this server, in registration order.
     * Populated automatically by GGWebSocketSchema.startServer() / .register().
     */
    get registeredWebSocketSchemas(): ReadonlyArray<AnyWebSocketSchema> {
        return this._registeredWebSocketSchemas;
    }

    /** @internal Called by GGWebSocketSchema.startServer(). Do not call directly. */
    public _registerWebSocketSchema(schema: AnyWebSocketSchema): void {
        this._registeredWebSocketSchemas.push(schema);
    }

    private readonly _schemasWithResolver = new Set<object>();

    /** @internal Called by HTTP / WS register paths when a scope resolver is wired. */
    public _markResolverWired(schema: object): void {
        this._schemasWithResolver.add(schema);
    }

    private _checkPermissionsAtStart(): void {
        type Surface = {label: string; permission: GGPermission | undefined; resolverWired: boolean};
        const surfaces: Surface[] = [];

        for (const schema of this._registeredSchemas) {
            const resolverWired = this._schemasWithResolver.has(schema);
            const methods = schema.contract?.methods ?? {};
            for (const name of Object.keys(methods)) {
                surfaces.push({
                    label: `${schema.name}.${name}`,
                    permission: (methods[name] as GGContractMethod).permission,
                    resolverWired,
                });
            }
        }
        for (const ws of this._registeredWebSocketSchemas) {
            const resolverWired = this._schemasWithResolver.has(ws);
            const methods = ws.contract.clientToServer.methods;
            for (const name of Object.keys(methods)) {
                surfaces.push({
                    label: `${ws.name}.${name}`,
                    permission: methods[name].permission,
                    resolverWired,
                });
            }
            if (ws.connectPermission !== undefined) {
                surfaces.push({
                    label: `${ws.name} (connectPermission)`,
                    permission: ws.connectPermission,
                    resolverWired,
                });
            }
        }

        let strict = false;
        const undeclared: Surface[] = [];
        const orphaned: Surface[] = [];
        for (const s of surfaces) {
            if (s.permission !== undefined || s.resolverWired) strict = true;
            if (s.permission === undefined) undeclared.push(s);
            else if (s.permission !== GG_NO_PERMISSIONS && !s.resolverWired) orphaned.push(s);
        }
        if (!strict) return;

        if (undeclared.length > 0) {
            const lines = undeclared.map(s => `  ${s.label}`).join("\n");
            throw new Error(
                `GGHttpServer: permission strict mode is active on this server ` +
                `(at least one route declares a permission or has .usePermissions(...) wired), ` +
                `but the following routes have no \`permission\` declared:\n\n` +
                lines +
                `\n\nFix: declare \`permission\` on every route — use \`GG_NO_PERMISSIONS\` for intentionally public ones.`
            );
        }
        if (orphaned.length > 0) {
            const lines = orphaned.map(s =>
                `  ${s.label}   requires ${describePermission(s.permission)}`
            ).join("\n");
            throw new Error(
                `GGHttpServer: these routes declare non-public permissions but their schema was ` +
                `registered without a scope resolver:\n\n` +
                lines +
                `\n\nFix: call \`.usePermissions(yourResolver)\` on the GGHttp chain (or pass ` +
                `\`permissionResolver\` to the WS schema config) before registering these routes.`
            );
        }
    }

    /** Smart wires for every registered HTTP and WebSocket schema. */
    private _wireSurfaces(): WireSurface[] {
        const isSmart = (mw: unknown): mw is GGWireContextKey => mw instanceof GGWireContextKey && mw.isSmart;
        const out: WireSurface[] = [];
        for (const schema of this._registeredSchemas) {
            out.push({
                name: schema.name,
                wires: schema.apiMiddlewares.filter(isSmart),
            });
        }
        for (const ws of this._registeredWebSocketSchemas) {
            out.push({name: ws.name, wires: (ws.middlewares as unknown[]).filter(isSmart)});
        }
        return out;
    }

    private _checkWiresImplemented(surfaces: WireSurface[]): void {
        const missing: string[] = [];
        for (const surface of surfaces) {
            for (const wire of surface.wires) {
                if (!wire.hasHandler()) missing.push(`  ${surface.name}  uses wire "${wire.name}"`);
            }
        }
        if (missing.length > 0) {
            throw new Error(
                `GGHttpServer: these schemas .use() a smart wire that was never implemented on this ` +
                `runtime:\n\n` +
                missing.join("\n") +
                `\n\nFix: call \`${"<WIRE>"}.define(...).create(deps)\` in compose() before the server starts.`
            );
        }
    }

    public registerRoute(method: HttpMethod, path: string, handler: GGHttpRequestCallback): void {
        this.router.on(method as HTTPMethod, path, handler as unknown as findMyWay.Handler<findMyWay.HTTPVersion.V1>);
    }

    public async start(): Promise<void> {
        Object.freeze(this._registeredSchemas);
        const wireSurfaces = this._wireSurfaces();
        this._checkWiresImplemented(wireSurfaces);
        this._checkPermissionsAtStart();
        this._port = await new Promise((resolve) => {
            this.httpServer.listen(this.configuredPort, '0.0.0.0', () => {
                const port = (this.httpServer.address() as any).port;
                resolve(port);
            });
        });
        this._onStart.forEach(callback => callback());
        GGLog.info(this, `HTTP server started`, {
            port: this._port,
            runtime: this.runtimeName
        });
    }

    public async teardown(): Promise<void> {
        if (this.teardownPromise) {
            return this.teardownPromise;
        }
        return this.teardownPromise = (async () => {
            await Promise.all(this._onTeardown.map(callback => callback()));
            this.httpServer.close();
            const maxWaitTime = 3000;
            const deadline = performance.now() + maxWaitTime;
            while (this.activeRequests > 0 && performance.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            GGLog.info(this, `HTTP server stopped`);
        })();
    }

    public onStart(callback: () => Promise<void> | void): this {
        this._onStart.push(callback);
        return this;
    }

    public onTeardown(callback: () => Promise<void> | void): this {
        this._onTeardown.push(callback);
        return this;
    }
}

export type GGHttpRequestCallback = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;

/**
 * Computes CORS response headers for a request Origin. Pure (no req/res) so it is
 * unit-testable. Default (no config) = permissive `*`, no credentials. With config =
 * allowlisted: only a matching Origin is echoed (never `*`), `credentials` adds
 * Allow-Credentials, and Vary: Origin is always set so caches key on the origin.
 */
export function corsResponseHeaders(
    origin: string | undefined,
    cors: GGCorsConfig | undefined,
    allowHeaders: string,
    exposeHeaders: string
): Record<string, string> {
    if (!origin) return {};
    const headers: Record<string, string> = {};
    if (cors) {
        // Never reflect the literal "null" origin (sandboxed iframe / file:// / opaque
        // origins) with credentials — the classic null-origin credential-leak footgun.
        const allowed = origin !== "null" && (Array.isArray(cors.origins) ? cors.origins.includes(origin) : cors.origins(origin));
        headers['Vary'] = 'Origin';
        if (!allowed) return headers;
        headers['Access-Control-Allow-Origin'] = origin;
        if (cors.credentials) headers['Access-Control-Allow-Credentials'] = 'true';
    } else {
        headers['Access-Control-Allow-Origin'] = '*';
    }
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] = allowHeaders;
    if (exposeHeaders) headers['Access-Control-Expose-Headers'] = exposeHeaders;
    return headers;
}
