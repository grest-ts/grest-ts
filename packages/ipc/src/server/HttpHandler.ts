import * as http from 'http';
import {GGLog} from "@grest-ts/logger";
import httpProxy from "http-proxy";

/** Where a request goes: a base URL to proxy to, a handler that answers it, or nowhere (404). */
export type HttpRoute = string | ((req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>) | undefined;

export type HttpResolver = (req: http.IncomingMessage) => HttpRoute;

export class HttpHandler {

    private resolver!: HttpResolver
    private readonly proxy: httpProxy;

    constructor() {
        this.proxy = httpProxy.createProxyServer({});
    }

    public setResolver(resolver: HttpResolver) {
        this.resolver = resolver
    }

    public async handleRequest(
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): Promise<void> {
        let route: HttpRoute;
        try {
            route = this.resolver(req);
            if (typeof route === "function") {
                await route(req, res);
                return;
            }
        } catch (err: any) {
            GGLog.error(this, `HTTP route error [${req.method} ${req.url}]: ${err.message}`, err);
            if (res.headersSent) {
                res.destroy();
            } else {
                this.sendResponse(res, 500, {error: err.message});
            }
            return;
        }

        if (route) {
            GGLog.debug(this, `Proxying ${req.method} ${req.url} -> ${route}`);
            this.proxy.web(req, res, {target: route}, (err: any) => {
                const code = err?.code ?? err?.errors?.[0]?.code ?? 'UNKNOWN';
                GGLog.error(this, `Proxy error [${code}] ${req.method} ${req.url} -> ${route}: ${err.message}`);
                this.sendResponse(res, 502, {issue: `Proxy error [${code}] -> ${route}: ${err.message} (Did the service crash?)`});
            });
            return;
        }

        this.sendResponse(res, 404, {error: `No route for ${req.method} ${req.url}! Did you forget to start a service that defines this path?`});
    }

    private sendResponse(res: http.ServerResponse, status: number, data?: any): void {
        res.writeHead(status, {'Content-Type': 'application/json'});
        res.end(data !== undefined ? JSON.stringify(data) : '');
    }
}
