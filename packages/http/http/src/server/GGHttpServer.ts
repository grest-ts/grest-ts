import http from "http";
import {HttpMethod, HttpStatusCode} from "@grest-ts/common";
import {GGLocator, GGLocatorKey, GGLocatorScope, GGLocatorServiceType} from "@grest-ts/locator";
import {GG_HTTP_SERVER} from "./GG_HTTP_SERVER";
import {GGLog} from "@grest-ts/logger";
import findMyWay, {HTTPMethod} from "find-my-way";
import type {GGHttpSchema} from "../schema/GGHttpSchema";

export interface GGHttpServerAdapterConfig {
    key?: GGLocatorKey<GGHttpServer>;
    port?: number;
}

export class GGHttpServer {

    protected _port: number | undefined;
    protected teardownPromise: Promise<void> | undefined;
    protected readonly scope: GGLocatorScope;
    protected readonly runtimeName: string;
    private readonly configuredPort: number;

    private readonly _onStart: Array<() => void> = [];
    private readonly _onTeardown: Array<() => void> = [];

    /**
     * All GGHttpSchema instances registered on this server, in order of registration.
     * Populated automatically by schema.register() / GGHttp.http() during compose().
     * Useful for tools like @grest-ts/openapi that need the full set of registered schemas.
     */
    public readonly registeredSchemas: GGHttpSchema<any, any>[] = [];

    public readonly httpServer: http.Server;
    private activeRequests = 0;
    private router = findMyWay<findMyWay.HTTPVersion.V1>();

    constructor(config?: GGHttpServerAdapterConfig) {

        this.runtimeName = GGLocator.getScope().serviceName;
        this.scope = GGLocator.getScope();
        this.configuredPort = config?.port ?? (process.env.PORT ? Number(process.env.PORT) : 0);

        GGLocator.getScope().setWithLifecycle(config?.key ?? GG_HTTP_SERVER, this, {
            type: GGLocatorServiceType.HTTP,
            start: this.start.bind(this),
            teardown: this.teardown.bind(this)
        });

        this.httpServer = http.createServer(async (req, res) => {
            if (this.teardownPromise) {
                res.statusCode = HttpStatusCode.ServerTemporarilyNotAvailable503;
                res.end();
                return;
            }
            this.activeRequests++;
            try {
                if (req.headers.origin) { // For browsers
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
                    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-org-token');
                    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
                }
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
        });
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

    public registerRoute(method: HttpMethod, path: string, handler: GGHttpRequestCallback): void {
        this.router.on(method as HTTPMethod, path, handler as unknown as findMyWay.Handler<findMyWay.HTTPVersion.V1>);
    }

    public async start(): Promise<void> {
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
