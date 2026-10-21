# Plan: Unified API Docs (`@grest-ts/api-docs`)

## Goal

Give grest-ts users a single, batteries-included way to publish API documentation that covers both HTTP and WebSocket contracts in one UI — without taking away the lower-level building blocks.

Three audiences, three packages, one new top-level option:

| Audience | Package | Use it when |
|---|---|---|
| Spec only, no UI (CI / SDK pipelines) | `@grest-ts/openapi` (`toOpenApi`), `@grest-ts/asyncapi` (`toAsyncApi`) | You just need standards-compliant JSON to feed into `openapi-generator-cli`, Postman, contract tests, etc. |
| Single-protocol live UI | `GGOpenApiDocs` / `GGAsyncApiDocs` (existing) | HTTP-only or WS-only services that want vanilla Swagger UI / AsyncAPI Studio |
| Mixed HTTP + WS, unified UI | `@grest-ts/api-docs` (new) | Typical grest-ts service — has both protocols and you want one doc page |

`@grest-ts/api-docs` is additive: nothing in the existing packages is removed or hidden. The lower packages are still publicly usable for direct spec generation.

## Background

Today `@grest-ts/openapi` and `@grest-ts/asyncapi` each serve their own UI on a separate path. A typical grest-ts service exposes both HTTP and WebSocket APIs, so consumers end up jumping between `/docs` (Swagger UI) and `/asyncapi-docs` (AsyncAPI Studio). The framework guide currently recommends manually wiring a Swagger UI multi-spec switcher in HTML for the multi-service case — which is fragile and feels off-brand.

`@grest-ts/api-docs` solves both problems by owning the UI shell (a small custom HTML/JS page with sidebar navigation) and embedding the official renderers per pane: Swagger UI for OpenAPI specs, `@asyncapi/react-component` for AsyncAPI specs. The shell handles grouping, switching, deep linking; the embedded renderers do what they already do best.

The JSON specs themselves are unchanged — same OpenAPI 3.1 / AsyncAPI 3.0 output that `toOpenApi()` / `toAsyncApi()` already produce, served at predictable URLs that any external tool can consume.

---

## Phase 1: Repo restructure

Move the two existing docs packages into a `packages-libs/docs/` parent so the new package sits alongside them.

### 1a. File moves

```
packages-libs/openapi/    →  packages-libs/docs/openapi/
packages-libs/asyncapi/   →  packages-libs/docs/asyncapi/
                              packages-libs/docs/api-docs/    (new)
```

### 1b. Workspace patterns

**File:** `package.json` (root)

Add `"packages-libs/docs/*"` to the `workspaces` array. The existing `"packages-libs/*"` line stays — it picks up other top-level libs like `struct`, `sql`. This mirrors how `"packages-libs/db/*"` is already declared alongside `"packages-libs/*"`.

### 1c. tsconfig path mappings

**File:** `tsconfig.base.json`

Update `paths` entries for `@grest-ts/openapi` and `@grest-ts/asyncapi` to point at the new directories. Add the entry for `@grest-ts/api-docs`.

### 1d. Internal references

- `packages-libs/asyncapi/src/toAsyncApi.ts` already imports from `@grest-ts/openapi` — no change (package-name import).
- `examples/grest-test/src/main.ts` uses `GGOpenApiDocs` / `GGAsyncApiDocs` by package name — no change.
- `docs-web/config.ts` `DOC_TREE` — replace `"openapi"` and `"asyncapi"` standalone entries with `{docs: ["api-docs", "openapi", "asyncapi"]}` group under "Libraries".
- `docs/dependencies.json` is generated; regenerate via the existing dependency-graph script after the move.

### 1e. Verification

Run `tsx grest.1.check.ts` to confirm tsconfig + package layout is valid. Run the existing test suite once before any code changes to confirm the move alone is non-breaking.

---

## Phase 2: Add `registerGroups()` to existing packages

Before building api-docs, give the lower-level packages a multi-group switcher of their own. This is what the framework guide will recommend for HTTP-only or WS-only services that need grouping (Option B / Option C from the API Docs guide).

### 2a. `GGOpenApiDocs.registerGroups()`

**File:** `packages-libs/docs/openapi/src/GGOpenApiDocs.ts`

Add a static method:

```typescript
static registerGroups(options: GGOpenApiDocsGroupsOptions): void
```

Where:

```typescript
export interface GGOpenApiDocsGroupsOptions extends Omit<ToOpenApiOptions, never> {
    /** Map of group label → schemas in that group. Each group becomes its own spec. */
    groups: Record<string, GGHttpSchema<any, any>[]>;

    /** Path prefix for spec endpoints. Each group is served at `${specPathPrefix}/${slug}.json`. */
    specPathPrefix: string;     // e.g. "/openapi" → /openapi/users.json, /openapi/orders.json

    /** Path where Swagger UI is served (single page with `urls: [...]` switcher). */
    docsPath: string;

    /** Which group opens by default. Defaults to the first key in `groups`. */
    primary?: string;

    /** Also serve a combined spec at `${specPathPrefix}/all.json` and add an "All APIs" entry. */
    combined?: boolean;

    /** Same escape hatches as register(). */
    cdnUrl?: string;
    customUi?: (config: SwaggerUiSwitcherConfig) => string;
    http?: GGHttpServer;
    eager?: boolean;
}

export interface SwaggerUiSwitcherConfig {
    title: string;
    urls: Array<{name: string; url: string}>;
    primaryName: string;
}
```

Implementation: loop over `groups`, build one spec per entry via existing `toOpenApi()`, register one route per spec, register the docs HTML at `docsPath` with Swagger UI configured with `urls: [...]` and `urls.primaryName`.

The HTML template grows a single conditional branch:
- If `urls` array → use `urls`/`urls.primaryName` config
- Else (single-spec case) → use `url` config (existing behavior)

### 2b. `GGAsyncApiDocs.registerGroups()`

**File:** `packages-libs/docs/asyncapi/src/GGAsyncApiDocs.ts`

Same shape, for WebSocket schemas. AsyncAPI's `@asyncapi/react-component` does not have a built-in multi-spec switcher, so the HTML template renders a small custom switcher (top bar with a `<select>`) above the embedded `AsyncApiStandalone.render()` call. When the selection changes, we re-render with the newly fetched spec.

This switcher is intentionally small and self-contained — a few dozen lines of JS in the HTML template. It is not user-facing API; it is hidden inside the package.

### 2c. Tests

**File:** `packages-libs/docs/openapi/test/openapi-groups.spec.ts`

1. `registerGroups()` mounts one route per group + one docs route.
2. Each spec endpoint returns the correct subset of operations.
3. Docs HTML contains the expected `urls` array.
4. `combined: true` adds the `all.json` route and entry.
5. `primary: "X"` sets `urls.primaryName` correctly.
6. `customUi` receives the right config object.

Symmetric tests for asyncapi.

---

## Phase 3: Create `@grest-ts/api-docs`

The unified shell package. Depends on `@grest-ts/openapi` and `@grest-ts/asyncapi` to actually generate specs; owns the shell HTML and the orchestration API.

### 3a. Package skeleton

**Files (new):**

- `packages-libs/docs/api-docs/grest.package.ts`
- `packages-libs/docs/api-docs/package.json` (generated)
- `packages-libs/docs/api-docs/tsconfig.json`
- `packages-libs/docs/api-docs/tsconfig.publish.json`
- `packages-libs/docs/api-docs/vitest.config.ts`
- `packages-libs/docs/api-docs/LICENSE`
- `packages-libs/docs/api-docs/README.md`

**`grest.package.ts`:**

```typescript
import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/api-docs",
    description: "Unified HTTP + WebSocket API documentation UI for grest-ts",
    keywords: ["api-docs", "openapi", "asyncapi", "swagger", "documentation"],
    targets: {node: true},
    hasTests: true,
    publishToNpm: true,
    dependencies: {
        "@grest-ts/openapi": "workspace:*",
        "@grest-ts/asyncapi": "workspace:*",
        "@asyncapi/react-component": "^2.0.0"
        // swagger-ui-dist comes transitively from @grest-ts/openapi
    }
})
```

### 3b. Public API — types

**File:** `packages-libs/docs/api-docs/src/types.ts`

```typescript
import type {GGHttpSchema} from "@grest-ts/http";
import type {GGWebSocketSchema} from "@grest-ts/websocket";

/** Schemas that belong to one logical group, organized by protocol. */
export interface ApiDocsGroup {
    http?: GGHttpSchema<any, any>[];
    ws?: GGWebSocketSchema<any, any, any, any, any>[];
    description?: string;
}

/** Shared options used by both live and static-build modes. */
export interface ApiDocsCommonOptions {
    title: string;
    version?: string;
    description?: string;

    /** When set, sidebar shows groups; each group can have HTTP and/or WS schemas. */
    groups?: Record<string, ApiDocsGroup>;

    /** Convenience for the ungrouped case — equivalent to one anonymous group. */
    http?: GGHttpSchema<any, any>[];
    ws?: GGWebSocketSchema<any, any, any, any, any>[];

    /** Which group opens by default. Defaults to first key in `groups`. */
    primary?: string;

    /** Visual customization knobs that don't require replacing the shell. */
    branding?: {
        logoUrl?: string;
        primaryColor?: string;
    };
}

/** Manifest served at /docs/manifest.json — drives the shell sidebar. */
export interface ApiDocsManifest {
    title: string;
    version?: string;
    description?: string;
    primary?: string;
    groups: Array<{
        name: string;
        description?: string;
        specs: Array<{
            type: "openapi" | "asyncapi";
            label: string;          // sidebar label, e.g. "HTTP", "WebSocket"
            url: string;            // relative URL for the spec JSON
        }>;
    }>;
    branding?: ApiDocsCommonOptions["branding"];
}
```

### 3c. Live mode — `GGApiDocs`

**File:** `packages-libs/docs/api-docs/src/GGApiDocs.ts`

```typescript
export interface GGApiDocsOptions extends ApiDocsCommonOptions {
    /** Mount path. All sub-routes hang off this prefix. */
    docsPath: string;            // e.g. "/docs"

    /** Build all specs eagerly at construction time (default: lazy on first request). */
    eager?: boolean;

    /** Override which HTTP server hosts the routes. Default: locator's GG_HTTP_SERVER. */
    http?: GGHttpServer;

    /** Load Swagger UI / AsyncAPI component from CDN instead of bundled assets. */
    cdnUrl?: {
        swaggerUi?: string;
        asyncApi?: string;
    };

    /** Replace the shell HTML entirely. Receives the manifest so the user
     *  can build their own switcher around the same standard spec endpoints. */
    customUi?: (manifest: ApiDocsManifest) => string;
}

export class GGApiDocs {
    static register(options: GGApiDocsOptions): void;
    constructor(server: GGHttpServer, options: GGApiDocsOptions);

    public getManifest(): ApiDocsManifest;
    public getSpec(group: string, type: "openapi" | "asyncapi"): unknown;
    public registerWith(server: GGHttpServer): this;
}
```

**Routes registered on the HTTP server:**

| Route | Purpose |
|---|---|
| `GET ${docsPath}` | Shell HTML (or `customUi` output) |
| `GET ${docsPath}/manifest.json` | The `ApiDocsManifest` JSON |
| `GET ${docsPath}/specs/${groupSlug}/openapi.json` | OpenAPI spec for group's HTTP schemas |
| `GET ${docsPath}/specs/${groupSlug}/asyncapi.json` | AsyncAPI spec for group's WS schemas |
| `GET ${docsPath}/assets/swagger-ui-bundle.js` | Bundled Swagger UI (skipped if `cdnUrl.swaggerUi`) |
| `GET ${docsPath}/assets/swagger-ui.css` | Bundled Swagger UI CSS |
| `GET ${docsPath}/assets/asyncapi-component.js` | Bundled AsyncAPI viewer (skipped if `cdnUrl.asyncApi`) |
| `GET ${docsPath}/assets/asyncapi-component.css` | Bundled AsyncAPI CSS |
| `GET ${docsPath}/assets/shell.js` | Shell logic |
| `GET ${docsPath}/assets/shell.css` | Shell styles |

`groupSlug` is `kebab-case(groupName)`. Spec is built lazily per group on first request (or eagerly if `options.eager`).

When `groups` is omitted and `http`/`ws` are passed at top level, the implementation synthesizes one anonymous group internally — same code path either way.

### 3d. The shell

**File:** `packages-libs/docs/api-docs/src/shell/index.html`

Static HTML loaded by the route handler (template literal, with the manifest URL injected). Layout:

```
┌─────────────────────────────────────────────┐
│ [logo] Title                       [search] │
├──────────────┬──────────────────────────────┤
│ Users        │                              │
│  ▸ HTTP    ◄ │   <swagger-ui mounted>       │
│  ▸ WebSocket │                              │
│ Orders       │                              │
│  ▸ HTTP      │                              │
└──────────────┴──────────────────────────────┘
```

**File:** `packages-libs/docs/api-docs/src/shell/shell.js`

Responsibilities (kept small — target ~300 lines):
1. Fetch `manifest.json`.
2. Render the sidebar — one collapsible section per group, one leaf per spec type with a small badge.
3. Wire up click handlers — selecting a leaf triggers a viewer swap.
4. Viewer registry (internal, type-keyed):
   - `openapi` → mount Swagger UI via `SwaggerUIBundle({url, dom_id, deepLinking: true})`
   - `asyncapi` → fetch the spec JSON and call `AsyncApiStandalone.render({schema, config: {show: {sidebar: false}}}, container)`
   (We hide AsyncAPI's own sidebar since our shell provides one — its operations list still appears in the main pane.)
5. URL hash routing — `#/<group-slug>/<type>/...` selects the entry; the trailing portion is forwarded to the embedded viewer's own deep-link state where possible (Swagger UI handles this natively via `deepLinking`).
6. Tear-down between swaps — clear the right pane, remove old script/style if needed (Swagger UI doesn't unmount cleanly; pragmatic approach is to recreate a fresh container `div` per swap).
7. Search box (optional in v1) — substring match against group/api/operation labels in the manifest. Defer to v2 if it bloats.

**File:** `packages-libs/docs/api-docs/src/shell/shell.css`

Minimal styling. Use plain CSS (no preprocessor), CSS custom properties for `branding.primaryColor`. ~150 lines.

### 3e. Viewer registry — internal extension point

**File:** `packages-libs/docs/api-docs/src/shell/viewers.js`

```javascript
const VIEWERS = {
    openapi: {
        mount(container, specUrl) { /* Swagger UI */ },
        unmount(container) { /* clear */ }
    },
    asyncapi: {
        mount(container, specUrl) { /* AsyncAPI react-component */ },
        unmount(container) { /* clear */ }
    }
};
```

Not exposed as a public API — there is no plugin loader, no extension docs. If a third spec type becomes relevant (gRPC, GraphQL, Smithy), the change is "add an entry to `VIEWERS`," not "rearchitect the package." This keeps the door open for future formats without paying any abstraction cost today.

### 3f. Static build mode — `buildApiDocs()`

**File:** `packages-libs/docs/api-docs/src/buildApiDocs.ts`

```typescript
export interface BuildApiDocsOptions extends ApiDocsCommonOptions {
    /** Output directory. Created if missing; not cleaned (caller's responsibility). */
    outDir: string;

    /** Override viewer asset source. When set, assets are NOT copied — HTML
     *  references the CDN URLs directly. */
    cdnUrl?: {
        swaggerUi?: string;
        asyncApi?: string;
    };

    /** Replace the shell HTML entirely. Receives the manifest. */
    customUi?: (manifest: ApiDocsManifest) => string;
}

export async function buildApiDocs(options: BuildApiDocsOptions): Promise<void>;
```

**Output structure (matches live mode's URL layout exactly):**

```
${outDir}/
├── index.html                          ← shell, references ./assets and ./specs with relative URLs
├── manifest.json
├── specs/
│   ├── ${groupSlug}/
│   │   ├── openapi.json                (only if group has http schemas)
│   │   └── asyncapi.json               (only if group has ws schemas)
│   └── ...
└── assets/                             ← omitted entirely if both CDNs are set
    ├── swagger-ui-bundle.js
    ├── swagger-ui.css
    ├── asyncapi-component.js
    ├── asyncapi-component.css
    ├── shell.js
    └── shell.css
```

Implementation: build the manifest, build each spec via `toOpenApi()` / `toAsyncApi()`, write JSON files, render `index.html` with the shell template (relative asset paths), copy bundled assets from `swagger-ui-dist` and `@asyncapi/react-component`.

The output is pure static — works on S3, GitHub Pages, Cloudflare Pages, behind any path prefix because all URLs in the shell HTML are relative.

### 3g. Public exports

**File:** `packages-libs/docs/api-docs/src/index-node.ts`

```typescript
export {GGApiDocs} from "./GGApiDocs";
export type {GGApiDocsOptions} from "./GGApiDocs";
export {buildApiDocs} from "./buildApiDocs";
export type {BuildApiDocsOptions} from "./buildApiDocs";
export type {
    ApiDocsCommonOptions,
    ApiDocsGroup,
    ApiDocsManifest
} from "./types";
```

---

## Phase 4: Tests

**File:** `packages-libs/docs/api-docs/test/manifest.spec.ts`
- Manifest is built correctly from grouped input.
- Manifest is built correctly from ungrouped (top-level `http`/`ws`) input.
- `primary` defaults to first group key when omitted.
- A group with only `http` produces only an openapi spec entry; same for `ws`.
- Group slugs are kebab-cased and unique-collision-protected (raise on collision).

**File:** `packages-libs/docs/api-docs/test/live.spec.ts`
- `GGApiDocs.register()` mounts all expected routes.
- Each spec endpoint returns valid spec JSON matching what `toOpenApi()` / `toAsyncApi()` produce directly.
- The shell HTML route returns 200 and contains the manifest URL.
- Asset routes return correct `Content-Type` and serve the right bytes.
- `cdnUrl.swaggerUi` skips the swagger asset routes; same for asyncApi.
- `customUi` receives the manifest and its return value is served verbatim.

**File:** `packages-libs/docs/api-docs/test/build.spec.ts`
- `buildApiDocs()` writes the expected file tree to a temp dir.
- File contents byte-match what live mode would serve at the corresponding URLs.
- `cdnUrl` set on both → no `assets/` directory is created.
- `customUi` set → `index.html` contains the user output, not the default shell.

**File:** `packages-libs/docs/api-docs/test/shell.dom.spec.ts` (optional, defer if heavy)
- jsdom-based test of the shell JS: load a fixture manifest, click a sidebar entry, assert correct viewer mount call.

---

## Phase 5: Update existing callers and docs

### 5a. Showcase service

**File:** `examples/grest-test/src/main.ts`

Replace the two separate `GGOpenApiDocs.register()` + `GGAsyncApiDocs.register()` calls on the unified port with one `GGApiDocs.register()` call demonstrating grouping. Keep the standalone showcase server registrations (the `showcaseServer` and `asyncShowcaseServer` ones) as-is — they exist to demonstrate the lower-level packages.

### 5b. API Docs guide

**File:** `README-api-docs.md`

- Add a new top section: **"Mixed HTTP + WebSocket — `@grest-ts/api-docs`"** as the recommended path for typical grest-ts services. Show both live and static-build usage.
- Replace the handwritten Swagger UI HTML in Option B with `GGOpenApiDocs.registerGroups()` (HTTP-only switcher) and `GGAsyncApiDocs.registerGroups()` (WS-only switcher).
- Option C ("dedicated docs runtime") becomes a one-liner using `GGApiDocs` against shared `api/` packages, plus the `buildApiDocs()` static-export equivalent.
- Tip section gains: "Use `@grest-ts/api-docs` if your service has both HTTP and WebSocket APIs — it's the only way to render them in one page."

### 5c. Package READMEs

- `packages-libs/docs/api-docs/README.md` — new, follows the openapi/asyncapi structure (Features / Installation / Usage / Customization).
- `packages-libs/docs/openapi/README.md` — add a "Multi-group switcher" section demoing `registerGroups()`. Keep everything else intact.
- `packages-libs/docs/asyncapi/README.md` — same.

### 5d. docs-web sidebar

**File:** `docs-web/config.ts`

```typescript
"Libraries": [
    {db: ["db-mysql", "db-postgre"]},
    {docs: ["api-docs", "openapi", "asyncapi"]},
],
```

**File:** `docs-web/links.ts`

No change needed — `@pkg/api-docs` already resolves through the existing `pkg/` rule.

### 5e. Root README

**File:** `README.md`

In the "API Documentation (All optional)" section, prepend `@grest-ts/api-docs` as the recommended top-level option, with the other two listed as building blocks.

---

## Verification checklist

1. Existing test suite passes after Phase 1 (move-only, no logic changes) — confirms restructure was clean.
2. `tsx grest.1.check.ts` passes after each phase.
3. New `registerGroups()` tests pass (Phase 2).
4. New api-docs tests pass (Phase 3 / 4).
5. Manual smoke test: `cd examples/grest-test && tsx src/main.ts`, open the unified `/docs` URL, verify:
   - Both HTTP and WS specs visible in the sidebar
   - Switching between them swaps the embedded viewer cleanly
   - Deep links (refresh after picking an operation) restore the same view
   - `customUi` and `cdnUrl` overrides each work
6. Manual smoke test for static build: run `buildApiDocs()` to a temp dir, serve it with `npx http-server`, verify the same flows work without a runtime.
7. `docs-web` rebuilds cleanly and the new package + guide updates appear in the sidebar.

---

## Tradeoffs and decisions locked in

| Decision | Rationale |
|---|---|
| Three packages stay public; api-docs is additive | Spec-only and single-protocol cases shouldn't have to install / depend on the unified shell |
| asyncapi keeps importing `SchemaRegistry` from openapi | ~200 LOC overlap; not worth a fourth shared package; openapi is a clean dependency direction |
| Internal viewer registry (no public plugin API) | Future-proofs for new spec types without burdening today's users with an abstraction layer |
| AsyncAPI react-component vendored, not CDN-only | Parity with Swagger UI's offline guarantee; `cdnUrl.asyncApi` opt-out for users who prefer it slim |
| Combined per-group spec, not per-API | Cleaner sidebar; per-API spec users still have `toOpenApi([oneApi])` |
| Shell sits between user and Swagger UI by default | Users who specifically want vanilla Swagger UI keep `GGOpenApiDocs.register()` |
| Static and live modes share the manifest + URL layout | One mental model; specs swap-compatible between modes |
| Custom UI hook receives the manifest, not raw schemas | The user can build any UI they want around the same standards-compliant endpoints we already serve |

---

## Files modified (summary)

| File | Change |
|------|--------|
| `package.json` (root) | Add `"packages-libs/docs/*"` workspace pattern |
| `tsconfig.base.json` | Update `paths` for openapi/asyncapi; add api-docs |
| `docs-web/config.ts` | Replace flat openapi/asyncapi entries with `{docs: [...]}` group |
| `examples/grest-test/src/main.ts` | Switch unified-server registrations to `GGApiDocs.register()` |
| `README.md` | Reorder API Documentation section; api-docs first |
| `README-api-docs.md` | Major rewrite — api-docs as top recommendation; `registerGroups()` for single-protocol |
| `packages-libs/docs/openapi/src/GGOpenApiDocs.ts` | Add `registerGroups()` static + multi-spec HTML branch |
| `packages-libs/docs/asyncapi/src/GGAsyncApiDocs.ts` | Add `registerGroups()` static + custom switcher in HTML template |
| `packages-libs/docs/openapi/README.md` | Document `registerGroups()` |
| `packages-libs/docs/asyncapi/README.md` | Document `registerGroups()` |

## Files moved

| Old path | New path |
|---|---|
| `packages-libs/openapi/` | `packages-libs/docs/openapi/` |
| `packages-libs/asyncapi/` | `packages-libs/docs/asyncapi/` |

## Files created

| File | Purpose |
|------|---------|
| `packages-libs/docs/api-docs/grest.package.ts` | Package definition |
| `packages-libs/docs/api-docs/tsconfig.json` | TypeScript config |
| `packages-libs/docs/api-docs/tsconfig.publish.json` | Publish config |
| `packages-libs/docs/api-docs/vitest.config.ts` | Test config |
| `packages-libs/docs/api-docs/LICENSE` | License |
| `packages-libs/docs/api-docs/README.md` | Public docs |
| `packages-libs/docs/api-docs/src/index-node.ts` | Public exports |
| `packages-libs/docs/api-docs/src/types.ts` | Manifest + options types |
| `packages-libs/docs/api-docs/src/GGApiDocs.ts` | Live mode (~300 lines) |
| `packages-libs/docs/api-docs/src/buildApiDocs.ts` | Static build mode (~150 lines) |
| `packages-libs/docs/api-docs/src/manifest.ts` | Shared manifest builder used by both modes |
| `packages-libs/docs/api-docs/src/shell/index.html.ts` | Shell HTML template (template literal) |
| `packages-libs/docs/api-docs/src/shell/shell.js` | Shell client logic (~300 lines) |
| `packages-libs/docs/api-docs/src/shell/shell.css` | Shell styles (~150 lines) |
| `packages-libs/docs/api-docs/src/shell/viewers.js` | Type → viewer registry |
| `packages-libs/docs/api-docs/test/manifest.spec.ts` | Manifest unit tests |
| `packages-libs/docs/api-docs/test/live.spec.ts` | Live mode integration tests |
| `packages-libs/docs/api-docs/test/build.spec.ts` | Static build tests |

---

## Out of scope for v1

- Cross-spec full-text search (defer to v2)
- Theming beyond `primaryColor` + `logoUrl` (defer)
- Multi-language docs (defer — `.docs()` doesn't carry localization yet)
- Interactive WebSocket "Try it out" in the AsyncAPI pane (the react-component supports rendering but not interactive sessions; defer)
- Public viewer plugin API for third-party spec types (deliberately deferred — internal registry only)
