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

        // AsyncAPI Studio HTML — served for docsPath and all sub-paths so that
        // sidebar deep-links (e.g. /asyncapi-docs/ChatApi_send_foo) stay on the
        // same page instead of opening a new tab or returning 404.
        const serveStudio = async (_req: any, res: any) => {
            const spec = this.getSpec();
            const html = buildAsyncApiStudioHtml(spec);
            res.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Content-Length": Buffer.byteLength(html)
            });
            res.end(html);
        };
        server.registerRoute("GET", docsPath, serveStudio);
        // Wildcard for deep-link navigation within the studio
        server.registerRoute("GET", docsPath + "/*", serveStudio);

        return this;
    }
}

/**
 * Build the AsyncAPI Studio HTML page with the spec embedded as inline JSON.
 * Embedding avoids the component fetching the spec by URL on each navigation,
 * which was causing the sidebar links to open new tabs.
 */
function buildAsyncApiStudioHtml(spec: AsyncAPIDocument): string {
    // Embed the spec as a JSON literal so the studio renders without any fetch
    const specJson = JSON.stringify(spec);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>AsyncAPI Docs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" href="https://www.asyncapi.com/favicon.ico" />
  <link rel="stylesheet" href="https://unpkg.com/@asyncapi/react-component@latest/styles/default.min.css">
</head>
<body>
<div id="asyncapi"></div>
<script src="https://unpkg.com/@asyncapi/react-component@latest/browser/standalone/index.js"></script>
<script>
  AsyncApiStandalone.render(
    {schema: {source: ${specJson}}, config: {show: {sidebar: true}}},
    document.getElementById('asyncapi')
  );
</script>
</body>
</html>`;
}
