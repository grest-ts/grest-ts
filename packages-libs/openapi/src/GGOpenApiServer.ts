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
     * than on first request.
     * @default false
     */
    eager?: boolean;
}

/**
 * Serves GET /openapi.json and GET /docs (Swagger UI) for a set of GGHttpSchema instances.
 *
 * @example
 * // Register via GGHttp builder (import side-effect augments GGHttp):
 * import "@grest-ts/openapi";
 *
 * const gg = new GGHttp(server);
 * gg.http(MyApiSchema, impl)
 *   .openApi([MyApiSchema], { title: "My API", version: "1.0.0" });
 *
 * @example
 * // Or use standalone:
 * const openApiServer = new GGOpenApiServer([MyApiSchema], { title: "My API" });
 * openApiServer.registerWith(server);
 */
export class GGOpenApiServer {
    private readonly schemas: GGHttpSchema<any, any>[];
    private readonly options: GGOpenApiServerOptions;
    private _spec: OpenAPIV3_1.Document | undefined;

    constructor(schemas: GGHttpSchema<any, any>[], options: GGOpenApiServerOptions = {}) {
        this.schemas = schemas;
        this.options = options;
        if (options.eager) {
            this._spec = this.buildSpec();
        }
    }

    private buildSpec(): OpenAPIV3_1.Document {
        return toOpenApi(this.schemas, this.options);
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
         * Register OpenAPI spec endpoint and Swagger UI on this HTTP server.
         *
         * @example
         * new GGHttp(server)
         *   .http(MyApiSchema, impl)
         *   .openApi([MyApiSchema], { title: "My API" });
         */
        openApi(schemas: GGHttpSchema<any, any>[], options?: GGOpenApiServerOptions): this;
    }
}

GGHttp.prototype.openApi = function (
    this: GGHttp,
    schemas: GGHttpSchema<any, any>[],
    options: GGOpenApiServerOptions = {}
): typeof this {
    const openApiServer = new GGOpenApiServer(schemas, options);
    openApiServer.registerWith((this as any).httpServer as GGHttpServer);
    return this;
};
