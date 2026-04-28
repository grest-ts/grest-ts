import * as http from 'http';
import {GGLog} from "@grest-ts/logger";
import {HttpMethod} from "@grest-ts/common";
import httpProxy from "http-proxy";
import findMyWay, {HTTPMethod} from "find-my-way";

/** HTTP route handler - receives body, path params, and headers. Returns response data (or void for empty 200) */
export type HttpRouteHandler = (body: any, pathParams?: Record<string, string>, headers?: Record<string, string>) => Promise<any>;

/** Default HTTP handler for unmatched routes (proxying) - gets raw req/res */
export type DefaultHttpHandler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;

interface RouteStore {
    handler: HttpRouteHandler;
}

export class HttpHandler {

    private router = findMyWay<findMyWay.HTTPVersion.V1>();
    private routeResolver: (path: string) => string
    private readonly proxy: httpProxy;

    constructor() {
        this.proxy = httpProxy.createProxyServer({});
    }

    public setRouteResolver(routeResolver: (path: string) => string) {
        this.routeResolver = routeResolver
    }

    public addRoute(method: HttpMethod, path: string, handler: HttpRouteHandler): void {
        const store: RouteStore = {handler};
        this.router.on(method as HTTPMethod, path, () => {
        }, store);
    }

    public removeRoute(method: HttpMethod, path: string): void {
        this.router.off(method as HTTPMethod, path);
    }

    public async handleRequest(
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): Promise<void> {
        const method = (req.method || 'GET') as HttpMethod;
        const url = req.url || '/';
        // Strip query string for route matching
        const path = url.split('?')[0];

        // Try to match a route
        const result = this.router.find(method as HTTPMethod, path);
        if (result?.store) {
            const store = result.store as RouteStore;
            const body = await this.readJsonBody(req);
            // Normalize headers to Record<string, string>
            const headers: Record<string, string> = {};
            for (const [key, value] of Object.entries(req.headers)) {
                if (value !== undefined) {
                    headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
                }
            }
            const pathParams = result.params as Record<string, string> || {};
            try {
                const responseData = await store.handler(body, pathParams, headers);
                this.sendResponse(res, 200, responseData);
            } catch (err: any) {
                GGLog.error(this, `HTTP route error [${method} ${path}]: ${err.message}`, err);
                this.sendResponse(res, 500, {error: err.message});
            }
            return;
        }

        const routeToUrl = this.routeResolver(path)
        if (routeToUrl) {
            GGLog.debug(this, `Proxying ${req.method} ${req.url} -> ${routeToUrl}`);
            this.proxy.web(req, res, {target: routeToUrl}, (err: any) => {
                const code = err?.code ?? err?.errors?.[0]?.code ?? 'UNKNOWN';
                GGLog.error(this, `Proxy error [${code}] ${req.method} ${req.url} -> ${routeToUrl}: ${err.message}`);
                this.sendResponse(res, 502, {issue: `Proxy error [${code}] -> ${routeToUrl}: ${err.message} (Did the service crash?)`});
            });
            return;
        }

        this.sendResponse(res, 404, {error: `No route for ${method} ${path}! Did you forget to start a service that defines this path?`});
    }

    private async readJsonBody(req: http.IncomingMessage): Promise<any> {
        return new Promise((resolve) => {
            let bodyStr = '';
            req.on('data', (chunk: Buffer) => {
                bodyStr += chunk.toString();
            });
            req.on('end', () => {
                try {
                    resolve(bodyStr ? JSON.parse(bodyStr) : undefined);
                } catch {
                    resolve(undefined);
                }
            });
            req.on('error', () => resolve(undefined));
        });
    }

    private sendResponse(res: http.ServerResponse, status: number, data?: any): void {
        res.writeHead(status, {'Content-Type': 'application/json'});
        res.end(data !== undefined ? JSON.stringify(data) : '');
    }
}
