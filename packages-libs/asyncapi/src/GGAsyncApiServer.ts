import type {GGWebSocketSchema} from "@grest-ts/websocket";
import {GGHttpServer} from "@grest-ts/http";
import type {AsyncAPIDocument} from "./AsyncApiTypes";
import {toAsyncApi, ToAsyncApiOptions} from "./toAsyncApi";

export interface GGAsyncApiServerOptions extends ToAsyncApiOptions {
    /**
     * Path where the JSON spec is served.
     * e.g. "/asyncapi.json"
     */
    specPath: string;

    /**
     * Path where the AsyncAPI Studio UI is served.
     * e.g. "/asyncapi-docs"
     */
    docsPath: string;

    /**
     * If true, build spec immediately on construction.
     * @default false (lazy on first request)
     */
    eager?: boolean;

    /**
     * Explicit schema list. When provided, overrides server.registeredWebSocketSchemas.
     */
    schemas?: GGWebSocketSchema<any, any, any, any, any>[];
}

/**
 * Serves GET /asyncapi.json and GET /asyncapi-docs (AsyncAPI Studio UI)
 * for all WebSocket schemas registered on a GGHttpServer.
 *
 * Schemas are collected automatically from server.registeredWebSocketSchemas,
 * or can be provided explicitly via options.schemas.
 *
 * @example
 * new GGAsyncApiServer(httpServer, {
 *     title: "My Service Events",
 *     version: "1.0.0",
 *     specPath: "/asyncapi.json",
 *     docsPath: "/asyncapi-docs"
 * }).registerWith(httpServer);
 */
export class GGAsyncApiServer {
    private readonly server: GGHttpServer;
    private readonly options: GGAsyncApiServerOptions;
    private _spec: AsyncAPIDocument | undefined;

    constructor(server: GGHttpServer, options: GGAsyncApiServerOptions) {
        this.server = server;
        this.options = options;
        if (options.eager) {
            this._spec = this.buildSpec();
        }
    }

    private buildSpec(): AsyncAPIDocument {
        const schemas = this.options.schemas
            ?? (this.server.registeredWebSocketSchemas as GGWebSocketSchema<any, any, any, any, any>[]);
        return toAsyncApi(schemas, this.options);
    }

    public getSpec(): AsyncAPIDocument {
        return this._spec ??= this.buildSpec();
    }

    public registerWith(server: GGHttpServer): this {
        const specPath = this.options.specPath;
        const docsPath = this.options.docsPath;

        server.registerRoute("GET", specPath, async (_req, res) => {
            const spec = this.getSpec();
            const body = JSON.stringify(spec, null, 2);
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body)
            });
            res.end(body);
        });

        // AsyncAPI Studio — served via CDN (no npm package available)
        const studioHtml = buildAsyncApiStudioHtml(specPath);
        server.registerRoute("GET", docsPath, async (_req, res) => {
            res.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Content-Length": Buffer.byteLength(studioHtml)
            });
            res.end(studioHtml);
        });

        return this;
    }
}

function buildAsyncApiStudioHtml(specUrl: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>AsyncAPI Docs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" href="https://www.asyncapi.com/favicon.ico" />
</head>
<body>
<script src="https://unpkg.com/@asyncapi/react-component@latest/browser/standalone/index.js"></script>
<link rel="stylesheet" href="https://unpkg.com/@asyncapi/react-component@latest/styles/default.min.css">
<div id="asyncapi"></div>
<script>
  AsyncApiStandalone.render(
    {schema: {url: ${JSON.stringify(specUrl)}, options: {resolve: true}}, config: {show: {sidebar: true}}},
    document.getElementById('asyncapi')
  );
</script>
</body>
</html>`;
}
