import type {GGWebSocketSchema} from "@grest-ts/websocket";
import {GGHttpServer, GG_HTTP_SERVER} from "@grest-ts/http";
import {GGLocator} from "@grest-ts/locator";
import type {AsyncAPIDocument} from "./AsyncApiTypes";
import {toAsyncApi, ToAsyncApiOptions} from "./toAsyncApi";

/**
 * Configuration passed to `customUi` so the user can build their own switcher
 * around the same per-group spec endpoints we serve.
 */
export interface AsyncApiSwitcherConfig {
    title: string;
    /** Each entry is one spec dropdown choice, in declaration order. */
    urls: Array<{name: string; url: string}>;
    /** Which `name` opens by default. */
    primaryName: string;
}

export interface GGAsyncApiDocsGroupsOptions extends ToAsyncApiOptions {
    /**
     * Map of group label → WebSocket schemas in that group. Each group
     * becomes its own AsyncAPI spec, served at `${specPathPrefix}/${slug}.json`.
     */
    groups: Record<string, GGWebSocketSchema<any>[]>;

    /** Path prefix for spec endpoints. e.g. `/asyncapi` → `/asyncapi/users.json`. */
    specPathPrefix: string;

    /** Path where the AsyncAPI Studio HTML is served. */
    docsPath: string;

    /** Which group opens by default. Must be a key of `groups`. */
    primary?: string;

    /** Build all specs eagerly at construction (default: lazy on first request). */
    eager?: boolean;

    /** Replace the AsyncAPI Studio HTML entirely. */
    customUi?: (config: AsyncApiSwitcherConfig) => string;

    /** Override the HTTP server. Defaults to the locator's GG_HTTP_SERVER. */
    http?: GGHttpServer;
}

/**
 * Multi-spec AsyncAPI Studio — one spec per logical group, switched via a
 * small built-in dropdown rendered above the embedded studio.
 *
 * AsyncAPI's react-component does not have a native multi-spec switcher, so
 * this package ships its own minimal one in the HTML template. The switcher
 * is intentionally hidden inside the package (no public API), to keep the
 * surface small.
 *
 * @example
 * GGAsyncApiDocs.registerGroups({
 *     groups: {
 *         "Chat":          [ChatApiSchema],
 *         "Notifications": [NotificationApiSchema],
 *     },
 *     specPathPrefix: "/asyncapi",
 *     docsPath: "/asyncapi-docs",
 * });
 */
export class GGAsyncApiDocsGroups {
    private readonly options: GGAsyncApiDocsGroupsOptions;
    private readonly groupKeys: string[];
    private readonly slugByGroup: Map<string, string>;
    private readonly specCache = new Map<string, AsyncAPIDocument>();

    static register(options: GGAsyncApiDocsGroupsOptions): void {
        const server = options.http ?? GGLocator.getScope().get(GG_HTTP_SERVER);
        if (!server) throw new Error("GGAsyncApiDocsGroups.register: no HTTP server found. Pass options.http or create a GGHttpServer first.");
        new GGAsyncApiDocsGroups(server, options);
    }

    constructor(server: GGHttpServer, options: GGAsyncApiDocsGroupsOptions) {
        this.options = options;
        this.groupKeys = Object.keys(options.groups);
        if (this.groupKeys.length === 0) {
            throw new Error("GGAsyncApiDocsGroups: `groups` must contain at least one entry.");
        }
        this.slugByGroup = buildSlugMap(this.groupKeys);
        if (options.primary !== undefined && !this.groupKeys.includes(options.primary)) {
            throw new Error(`GGAsyncApiDocsGroups: \`primary\` must be a key of \`groups\` (got ${options.primary}).`);
        }
        if (options.eager) {
            for (const name of this.groupKeys) this.specCache.set(name, this.buildSpec(name));
        }
        this.registerWith(server);
    }

    private buildSpec(group: string): AsyncAPIDocument {
        const schemas = this.options.groups[group];
        if (!schemas) throw new Error(`GGAsyncApiDocsGroups: unknown group ${group}`);
        return toAsyncApi(schemas, this.options);
    }

    public getSpec(group: string): AsyncAPIDocument {
        let spec = this.specCache.get(group);
        if (!spec) {
            spec = this.buildSpec(group);
            this.specCache.set(group, spec);
        }
        return spec;
    }

    public buildSwitcherConfig(): AsyncApiSwitcherConfig {
        const prefix = normalizePathPrefix(this.options.specPathPrefix);
        const urls = this.groupKeys.map(name => ({
            name,
            url: `${prefix}/${this.slugByGroup.get(name)!}.json`
        }));
        const primaryName = this.options.primary ?? this.groupKeys[0];
        return {title: this.options.title ?? "API", urls, primaryName};
    }

    public registerWith(server: GGHttpServer): this {
        const prefix = normalizePathPrefix(this.options.specPathPrefix);

        for (const name of this.groupKeys) {
            const slug = this.slugByGroup.get(name)!;
            server.registerRoute("GET", `${prefix}/${slug}.json`, async (_req, res) => {
                const spec = this.getSpec(name);
                const body = JSON.stringify(spec, null, 2);
                res.writeHead(200, {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body)
                });
                res.end(body);
            });
        }

        const docsPath = this.options.docsPath;
        const serveStudio = async (_req: any, res: any) => {
            const html = this.buildDocsHtml();
            res.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Content-Length": Buffer.byteLength(html)
            });
            res.end(html);
        };
        server.registerRoute("GET", docsPath, serveStudio);
        // Wildcard for sidebar deep-link navigation within the studio
        server.registerRoute("GET", docsPath + "/*", serveStudio);

        return this;
    }

    private buildDocsHtml(): string {
        const config = this.buildSwitcherConfig();
        if (this.options.customUi) return this.options.customUi(config);
        return buildSwitcherHtml(config);
    }
}

function normalizePathPrefix(prefix: string): string {
    let p = prefix.trim();
    if (!p.startsWith("/")) p = "/" + p;
    return p.replace(/\/+$/, "");
}

function toSlug(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        || "group";
}

function buildSlugMap(keys: string[]): Map<string, string> {
    const slugs = new Map<string, string>();
    const used = new Set<string>();
    for (const key of keys) {
        const slug = toSlug(key);
        if (used.has(slug)) {
            throw new Error(`GGAsyncApiDocsGroups: group names produce duplicate slug "${slug}". Rename one of: ${keys.filter(k => toSlug(k) === slug).join(", ")}`);
        }
        used.add(slug);
        slugs.set(key, slug);
    }
    return slugs;
}

/**
 * AsyncAPI Studio with a small custom switcher above it.
 *
 * The switcher is a plain `<select>` that fetches the chosen spec and
 * re-renders the studio with the new schema. We hide the studio's own
 * sidebar so the page stays uncluttered.
 */
function buildSwitcherHtml(config: AsyncApiSwitcherConfig): string {
    const optionsHtml = config.urls.map(u =>
        `<option value="${escapeHtml(u.url)}"${u.name === config.primaryName ? " selected" : ""}>${escapeHtml(u.name)}</option>`
    ).join("");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(config.title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" href="https://www.asyncapi.com/favicon.ico" />
  <link rel="stylesheet" href="https://unpkg.com/@asyncapi/react-component@latest/styles/default.min.css">
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
    .gg-switcher {
      padding: 12px 20px;
      background: #1a1a2e;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 16px;
      border-bottom: 1px solid #2a2a3e;
    }
    .gg-switcher-title { font-weight: 600; font-size: 16px; }
    .gg-switcher select {
      padding: 6px 12px;
      font-size: 14px;
      background: #2a2a3e;
      color: #fff;
      border: 1px solid #3a3a4e;
      border-radius: 4px;
      cursor: pointer;
    }
  </style>
</head>
<body>
<div class="gg-switcher">
  <span class="gg-switcher-title">${escapeHtml(config.title)}</span>
  <label>
    <span style="margin-right: 8px;">Spec:</span>
    <select id="gg-spec-switcher">${optionsHtml}</select>
  </label>
</div>
<div id="asyncapi"></div>
<script src="https://unpkg.com/@asyncapi/react-component@latest/browser/standalone/index.js"></script>
<script>
  const switcher = document.getElementById('gg-spec-switcher');
  const container = document.getElementById('asyncapi');
  async function loadSpec(url) {
    const res = await fetch(url);
    const schema = await res.json();
    container.innerHTML = '';
    AsyncApiStandalone.render(
      {schema: schema, config: {show: {sidebar: true}}},
      container
    );
  }
  switcher.addEventListener('change', e => loadSpec(e.target.value));
  loadSpec(switcher.value);
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]!);
}
