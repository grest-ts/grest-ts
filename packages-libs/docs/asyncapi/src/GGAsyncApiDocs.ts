import type {GGWebSocketSchema} from "@grest-ts/websocket";
import {GGHttpServer, GG_HTTP_SERVER} from "@grest-ts/http";
import {GGLocator} from "@grest-ts/locator";
import type {AsyncAPIDocument} from "./AsyncApiTypes";
import {toAsyncApi, ToAsyncApiOptions} from "./toAsyncApi";
import {GGAsyncApiDocsGroups, GGAsyncApiDocsGroupsOptions} from "./GGAsyncApiDocsGroups";

export interface GGAsyncApiDocsOptions extends ToAsyncApiOptions {
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
    schemas?: GGWebSocketSchema<any>[];

    /**
     * The HTTP server to register the docs routes on.
     * When omitted, uses the default GGHttpServer from the locator — the same
     * fallback as MyApi.register().
     */
    http?: GGHttpServer;
}

/**
 * Serves GET /asyncapi.json and GET /asyncapi-docs (AsyncAPI Studio UI)
 * for all WebSocket schemas registered on a GGHttpServer.
 *
 * Schemas are collected automatically from server.registeredWebSocketSchemas,
 * or can be provided explicitly via options.schemas.
 *
 * @example
 * // Mirrors MyApi.register() exactly — uses locator default when http is omitted:
 * GGAsyncApiDocs.register({
 *     title: "My Service Events",
 *     version: "1.0.0",
 *     specPath: "/asyncapi.json",
 *     docsPath: "/asyncapi-docs"
 * });
 *
 * @example
 * // With explicit server (same as MyApi.register(impl, {http: server})):
 * GGAsyncApiDocs.register({
 *     title: "My Service Events",
 *     specPath: "/asyncapi.json",
 *     docsPath: "/asyncapi-docs",
 *     http: server
 * });
 */
export class GGAsyncApiDocs {
    private readonly server: GGHttpServer;
    private readonly options: GGAsyncApiDocsOptions;
    private _spec: AsyncAPIDocument | undefined;

    /**
     * Register AsyncAPI docs routes on an HTTP server.
     * Mirrors the MyApi.register() pattern exactly:
     *   - options.http — explicit server (optional)
     *   - when absent, uses the default GGHttpServer from the locator
     */
    static register(options: GGAsyncApiDocsOptions): void {
        const server = options.http ?? GGLocator.getScope().get(GG_HTTP_SERVER);
        if (!server) throw new Error("GGAsyncApiDocs.register: no HTTP server found. Pass options.http or create a GGHttpServer first.");
        new GGAsyncApiDocs(server, options);
    }

    /**
     * Register a multi-spec AsyncAPI Studio with one spec per group, switched
     * via a small custom dropdown rendered above the studio. Useful when one
     * service exposes WebSocket APIs that consumers want to browse separately.
     *
     * @example
     * GGAsyncApiDocs.registerGroups({
     *     groups: { Chat: [ChatApiSchema], Notifications: [NotificationApiSchema] },
     *     specPathPrefix: "/asyncapi",
     *     docsPath: "/asyncapi-docs",
     * });
     */
    static registerGroups(options: GGAsyncApiDocsGroupsOptions): void {
        GGAsyncApiDocsGroups.register(options);
    }

    constructor(server: GGHttpServer, options: GGAsyncApiDocsOptions) {
        this.server = server;
        this.options = options;
        if (options.eager) {
            this._spec = this.buildSpec();
        }
        this.registerWith(server);
    }

    private buildSpec(): AsyncAPIDocument {
        const schemas = this.options.schemas
            ?? (this.server.registeredWebSocketSchemas as GGWebSocketSchema<any>[]);
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
 *
 * The spec is passed directly as the schema object (not wrapped in {url:...} or
 * {source:...}) — this is the correct API for inline document rendering and
 * avoids both external fetches and internal $ref resolution failures.
 *
 * The wildcard route (docsPath/*) is registered alongside docsPath so that
 * sidebar deep-links stay on the same page instead of opening a new tab.
 */
function buildAsyncApiStudioHtml(spec: AsyncAPIDocument): string {
    // Pass the document directly as schema — AsyncApiStandalone accepts the plain object
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
    {schema: ${specJson}, config: {show: {sidebar: true}}},
    document.getElementById('asyncapi')
  );
</script>
</body>
</html>`;
}
