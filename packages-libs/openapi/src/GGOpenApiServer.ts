import type {GGHttpSchema} from "@grest-ts/http";
import {GGHttp, GGHttpServer} from "@grest-ts/http";
import type {OpenAPIV3_1} from "openapi-types";
import {toOpenApi, ToOpenApiOptions} from "./toOpenApi";

export interface GGOpenApiServerOptions extends ToOpenApiOptions {
    /**
     * Path where the JSON spec is served.
     * @default "/openapi.json"
     */
    specPath?: string;

    /**
     * Path where the Swagger UI is served.
     * @default "/docs"
     */
    docsPath?: string;

    /**
     * If true, the OpenAPI spec is built immediately on construction rather
     * than on first request. When false (default), the spec is built lazily
     * on the first GET /openapi.json request, which means it captures every
     * schema that was registered during compose().
     * @default false
     */
    eager?: boolean;
}

/**
 * Serves GET /openapi.json and GET /docs (Swagger UI) for all schemas
 * registered on a GGHttpServer.
 *
 * Schemas are collected automatically — every schema.register() / GGHttp.http()
 * call during compose() is tracked on the server. The spec is built lazily
 * on first request (or eagerly if { eager: true }) so it always reflects the
 * full set of registered schemas.
 *
 * @example
 * // Fluent builder — openApi() reads all .http() schemas automatically:
 * import "@grest-ts/openapi";
 *
 * const server = new GGHttpServer();
 * new GGHttp(server)
 *     .http(MyApiSchema, impl)
 *     .openApi({ title: "My API", version: "1.0.0" });
 *
 * @example
 * // Standalone — also works when using schema.register() directly:
 * const httpServer = new GGHttpServer();
 * MyApi.register(impl);
 * new GGOpenApiServer(httpServer, { title: "My API" }).registerWith(httpServer);
 */
export class GGOpenApiServer {
    private readonly server: GGHttpServer;
    private readonly options: GGOpenApiServerOptions;
    private _spec: OpenAPIV3_1.Document | undefined;

    constructor(server: GGHttpServer, options: GGOpenApiServerOptions = {}) {
        this.server = server;
        this.options = options;
        if (options.eager) {
            this._spec = this.buildSpec();
        }
    }

    private buildSpec(): OpenAPIV3_1.Document {
        return toOpenApi(this.server.registeredSchemas, this.options);
    }

    public getSpec(): OpenAPIV3_1.Document {
        return this._spec ??= this.buildSpec();
    }

    public registerWith(server: GGHttpServer): this {
        const specPath = this.options.specPath ?? "/openapi.json";
        const docsPath = this.options.docsPath ?? "/docs";

        server.registerRoute("GET", specPath, async (_req, res) => {
            const spec = this.getSpec();
            const body = JSON.stringify(spec, null, 2);
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body)
            });
            res.end(body);
        });

        server.registerRoute("GET", docsPath, async (_req, res) => {
            const html = buildSwaggerUiHtml(specPath);
            res.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Content-Length": Buffer.byteLength(html)
            });
            res.end(html);
        });

        return this;
    }
}

function buildSwaggerUiHtml(specUrl: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>API Docs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
  SwaggerUIBundle({
    url: ${JSON.stringify(specUrl)},
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
    layout: 'BaseLayout',
    deepLinking: true
  });
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// GGHttp module augmentation — adds .openApi() to the builder chain
// ---------------------------------------------------------------------------

declare module "@grest-ts/http" {
    interface GGHttp<TContext = undefined> {
        /**
         * Register OpenAPI spec endpoint and Swagger UI for all schemas
         * registered on this GGHttp instance via .http().
         *
         * Schemas are collected automatically — no need to list them again.
         * The spec is built lazily on the first request so it captures every
         * schema registered before the server starts.
         *
         * @example
         * new GGHttp(server)
         *   .http(MyApiSchema, impl)
         *   .openApi({ title: "My API" });
         */
        openApi(options?: GGOpenApiServerOptions): this;
    }
}

GGHttp.prototype.openApi = function (
    this: GGHttp,
    options: GGOpenApiServerOptions = {}
): typeof this {
    const openApiServer = new GGOpenApiServer(this.httpServer, options);
    openApiServer.registerWith(this.httpServer);
    return this;
};

// Keep backward-compatible overload that still accepts an explicit schema list.
// This is useful for toOpenApi() in CI scripts and standalone GGOpenApiServer usage.
export type {GGHttpSchema};
