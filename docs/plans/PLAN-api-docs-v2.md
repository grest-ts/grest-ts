# Plan: `@grest-ts/api-docs` v2 — native contract documentation portal

## What this supersedes

This plan replaces `PLAN-api-docs.md` and the v1 `@grest-ts/api-docs` package shipped earlier today. **No backward compatibility** — v1 hasn't been released, the prior shell is thrown away. The package name, file location, and `GGApiDocs` / `buildApiDocs` entry-point names stay; everything inside changes.

## Goal

Build a polished, native documentation UI for grest-ts services that renders **directly from contracts**, not from OpenAPI/AsyncAPI specs. The UI knows grest-ts's first-class concepts (typed errors, brand types, WS interaction patterns, the typed client) and surfaces them honestly.

OpenAPI and AsyncAPI become **industry exports** — peer packages that produce standards-compliant JSON for external tooling — not the source of truth for our docs UI. The api-docs UI offers small "Download OpenAPI / AsyncAPI" buttons but does not run on those formats.

## Why this shape

A contract carries information that OpenAPI and AsyncAPI flatten or lose:

| grest-ts concept | OpenAPI/AsyncAPI representation | What we lose |
|---|---|---|
| `errors: [INSUFFICIENT_FUNDS, …]` typed as discriminated union | One-of error responses by status code | The TypeScript-shaped union — the thing callers actually pattern-match on |
| `IsEmail`, `IsTimestamp`, `IsLatitude` brand types | `format: "email"` | Brand identity, semantic meaning, the brand chain |
| WS request/response, fire-and-forget, server push, server-initiated | AsyncAPI `send` / `receive` / `reply` | Pattern semantics — flattened into operation+message+reply primitives |
| `client.users.get({id})` typed call | `curl -X GET /api/users/...` | The way grest-ts users actually consume their own APIs |
| `mockOf(UserService)…` test recipe | — | Doesn't exist in OpenAPI; can't be expressed |
| `Api.createClient()` cross-service call relationships | — | Service map metadata invisible to specs |

The v1 shell tried to compose two third-party renderers (Swagger UI + AsyncAPI react-component) on top of generated specs. This plan flips it: render contracts natively in a React UI we own end-to-end, and treat OpenAPI/AsyncAPI as *exports* offered alongside.

## Three peer packages — fully independent

```
packages-libs/docs/
├── api-docs/        ← THE PRIMARY DOCS UI — renders contracts directly
│                      React app, Vite-built, ships pre-built assets
│                      Live mode (GGApiDocs.register) + static mode (buildApiDocs)
│                      NO dependency on openapi/asyncapi
│
├── openapi/         ← INDUSTRY EXPORT — toOpenApi() + optional GGOpenApiDocs (Swagger UI)
│                      Standalone; install if you want OpenAPI tooling
│
└── asyncapi/        ← INDUSTRY EXPORT — toAsyncApi() + optional GGAsyncApiDocs (Studio)
                       Standalone; install if you want AsyncAPI tooling
```

**No coupling between the three.** Each package has one job and one audience:

- **api-docs** is for users browsing their own service docs. It renders contracts *directly* — `GGSchemaDescription` walked through our React UI, no intermediate spec format, no information loss. Opinionated grouping (groups → contracts → methods) optimized for navigation.
- **openapi / asyncapi** are exports for *external tooling* — SDK generators, Postman, contract testing, AsyncAPI Studio. They emit standards-compliant JSON. They are *not* what api-docs reads.

The earlier plan had api-docs depend on openapi/asyncapi for an "Export ▾" download menu. That's been dropped: the api-docs grouping has no clean mapping to OpenAPI's structure, so any export from that menu would either pick one grouping (losing the others) or emit one spec per group (consumers have to stitch). Keeping the standards exports as completely separate packages means they can stay aligned with the *spec's* native shape, not ours.

---

## Phase 1: Internal contract document format

The whole UI runs off one JSON document. Define it cleanly upfront — this is a public-ish artifact that's also the first thing tooling/AI-assistants would consume.

### Format design — `ApiDocsDocument` v1.0

```typescript
interface ApiDocsDocument {
    /** Format version — bumps on breaking changes. */
    version: "1.0";

    /** Service-level metadata. */
    service: {
        name: string;                        // e.g. "MyOrg Platform"
        version?: string;
        description?: string;                // markdown allowed
        runtimes?: string[];                 // e.g. ["app", "orders"] — for service map
    };

    /** User-defined groups (sidebar top-level). */
    groups: GroupDoc[];

    /** Shared schema dictionary — named schemas referenced by $ref. */
    schemas: Record<string, NamedSchemaDoc>;

    /** Shared error dictionary — every ERROR class referenced anywhere. */
    errors: Record<string, ErrorDoc>;

    /** Optional service-map metadata — captured during compose() if available. */
    serviceMap?: ServiceMapDoc;

    /** Branding / theming hints (logo URL, primary color). */
    branding?: BrandingDoc;
}

interface GroupDoc {
    name: string;
    slug: string;                            // url-safe; collision-checked
    description?: string;
    contracts: ContractDoc[];
}

interface ContractDoc {
    /** Contract name from `GGContractClass(name, …)`. */
    name: string;

    kind: "http" | "ws";

    /** HTTP-only — pathPrefix from httpSchema(...).pathPrefix(...) */
    pathPrefix?: string;

    /** WS-only — channel address (e.g. "ws/chat") */
    path?: string;

    description?: string;

    /** Auth derived from middleware headers tagged with format: "bearer" | "api-key" */
    auth?: AuthDoc[];

    /** Methods on the contract, in declaration order. */
    methods: MethodDoc[];
}

interface MethodDoc {
    name: string;                            // e.g. "getProfile"
    summary?: string;                        // human title; defaults to camelToTitle(name)
    description?: string;                    // markdown allowed; from contract method .docs()

    /** HTTP-only fields. */
    httpMethod?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    httpPath?: string;                       // full path with :params, e.g. "/api/users/:id"
    pathParams?: ParamDoc[];                 // extracted from httpPath
    queryParams?: ParamDoc[];                // GET/DELETE-only; from input
    requestBody?: SchemaRef;                 // POST/PUT-only; from input
    responseHeaders?: Record<string, SchemaRef>;

    /** WS-only fields. */
    wsDirection?: "client-to-server" | "server-to-client";
    wsPattern?: "request-response" | "fire-and-forget" | "server-push" | "server-initiated-request";
    wsInput?: SchemaRef;

    /** Shared. */
    successResponse?: SchemaRef;             // Response shape on success; absent ⇒ void
    errors: string[];                        // Keys into document.errors

    deprecated?: boolean;
    deprecationMessage?: string;
}

interface ParamDoc {
    name: string;
    schema: SchemaRef;
    required: boolean;
    description?: string;
}

/**
 * Reference into the shared schema dictionary, OR an inline schema.
 *
 * The `inline` form embeds a `JsonSchemaDescription` — a JSON-safe adapter
 * over `GGSchemaDescription` (see below) that swaps the non-JSON `schema`
 * and `canonical` GGSchema instance references for opaque string IDs.
 */
type SchemaRef =
    | { ref: string }                        // → document.schemas[ref]
    | { inline: JsonSchemaDescription };

/**
 * JSON-safe view of `GGSchemaDescription`.
 *
 * grest-ts already has a format-agnostic schema description (defined in
 * `packages/schema/schema/src/GGSchemaDescription.ts`) — the openapi
 * package consumes it via `schemaDescriptionToOpenApi`. We reuse the
 * exact same shape here, with two adjustments to make it serializable:
 *
 *   1. The `schema` and `canonical` fields (which are `GGSchema<any>`
 *      instances) are replaced with stable string IDs derived from the
 *      canonical identity. Two descriptions sharing the same canonical
 *      get the same `canonicalId` — same dedup logic SchemaRegistry uses.
 *
 *   2. The `node` discriminated union and `docs` annotation block are
 *      preserved verbatim — all the same fields (`kind: "string"|"number"|
 *      "boolean"|"bit"|"literal"|"array"|"object"|"record"|"union"|
 *      "discriminated"|"tuple"|"any"|"unknown"|"file"|"password"`,
 *      plus `nullable`, `optional`, `defaultValue`).
 *
 * The schema renderer in the React UI dispatches on `node.kind`, the same
 * union grest-ts already exposes. No bespoke schema type to maintain.
 *
 * Brand-typed schemas surface via `docs.title` and `docs.format` on a
 * primitive `node` — that's how brand identity is already represented in
 * grest-ts at runtime (since `.brand()` is a type-level operation only).
 *
 * Full type:
 *   interface JsonSchemaDescription {
 *       schemaId: string;          // replaces `schema` GGSchema reference
 *       canonicalId?: string;      // replaces `canonical` reference
 *       node: GGSchemaNodeKind;    // verbatim, with nested descriptions
 *                                  // also converted to JsonSchemaDescription
 *       docs?: GGSchemaDocs;       // verbatim
 *       defaultValue?: unknown;
 *       nullable: boolean;
 *       optional: boolean;
 *   }
 */

interface NamedSchemaDoc {
    /** Canonical title used as the dictionary key (PascalCase). */
    title: string;
    description?: string;
    schema: JsonSchemaDescription;           // full, never a $ref to itself
    /** Where this schema is used — back-references for the schema detail page. */
    usedIn?: Array<{ contract: string; method: string; location: "input"|"success"|"error"|"property" }>;
}

interface ErrorDoc {
    type: string;                            // "VALIDATION_ERROR"
    statusCode: number;
    description?: string;
    data?: SchemaRef;                        // typed error payload, if any
    /** Where this error is used. */
    usedIn?: Array<{ contract: string; method: string }>;
}

interface AuthDoc {
    scheme: "bearer" | "api-key";
    headerName: string;
    description?: string;
}

interface ServiceMapDoc {
    runtimes: Array<{ name: string; provides: string[] /* contract names */ }>;
    edges: Array<{ from: string; to: string; via: string /* contract name */ }>;
    events?: Array<{ runtime: string; eventName: string }>;
}

interface BrandingDoc {
    logoUrl?: string;
    primaryColor?: string;
    fontFamily?: string;
}
```

**What we reuse vs invent.** The schema portion of the document is **`GGSchemaDescription`**, the format-agnostic intermediate representation grest-ts already exposes (`packages/schema/schema/src/GGSchemaDescription.ts`). The openapi package already consumes it via `schemaDescriptionToOpenApi`. Reusing it here means:

- Schema renderer dispatches on the same `GGSchemaNodeKind` union grest-ts already defines — anyone who knows grest-ts schemas can read the doc format
- Brand-type rendering uses the same `docs.title` + `docs.format` convention the openapi package already uses, so visual consistency between our UI and exported OpenAPI specs is automatic
- The day a new `GGSchemaNodeKind` variant lands in grest-ts (e.g. `bigint`), the docs UI gains it without us touching anything

The only additions on top are the **wrapping document** (`service`, `groups`, `contracts`, `methods`, `errors` dictionary) and a thin JSON adapter that swaps `GGSchema` instance references for stable string IDs (the same canonical-identity dedup `SchemaRegistry` already does in `@grest-ts/openapi`).

**Why not just use OpenAPI's JSON Schema dialect?**
- WS patterns as first-class enum on `MethodDoc` instead of inferred from operation+reply structure
- Errors as a top-level dictionary with typed data, not buried in response codes
- Path/query parameters separated from request body explicitly
- Service-map metadata included
- Schema cross-references (`usedIn`) for navigation

### Generator — `buildContractDoc(options)`

**File:** `packages-libs/docs/api-docs/src/buildContractDoc.ts`

Pure function, no side effects. Same input as `GGApiDocs.register` (groups of HTTP/WS schemas) → returns `ApiDocsDocument`.

Internals:
1. Walk every contract. Build `ContractDoc` skeleton.
2. For each method, classify: HTTP verb + path / WS direction + pattern.
3. Walk each method's input/success/errors. For each schema, call `toSchemaDoc(schema)`.
4. For each input/success/error schema, call `schema.toSchemaDescription()` (existing grest-ts API) and walk it via the JSON adapter. When a node has `docs.title`, extract its canonical into `document.schemas[title]` and return `{ref: title}`. Otherwise inline. Same dedup logic SchemaRegistry already uses, just a different output shape.
5. Each error class encountered goes into `document.errors[ERROR.TYPE]` once; methods reference by key.
6. Middleware headers with `format: "bearer"` / `"api-key"` populate `contract.auth`.
7. After full pass: walk `document.schemas` and `document.errors`, fill in `usedIn` back-references.

Tests:
- Round-trip a contract → doc → assert structure (no UI)
- JSON adapter is sound — `JSON.stringify(doc)` and reparse without loss
- WS patterns are correctly classified (request-response / fire-and-forget / server-push / server-initiated)
- Named schemas extract once via canonical identity, get back-references
- Errors deduplicate
- Brand-typed schemas surface their `docs.title` and `docs.format` correctly

---

## Phase 2: React app skeleton

The UI is a single-page React app. Lives at `packages-libs/docs/api-docs/ui/`, built by Vite into `packages-libs/docs/api-docs/dist-ui/` (committed, shipped with the package — users do not rebuild).

### Stack

- **React 19** + TypeScript
- **Vite 7** for dev/build
- **Tailwind CSS 4** for styling — utility-first, CSS-vars driven, ~10 KB of generated CSS for our usage
- **Radix UI primitives** (`@radix-ui/react-*`) for accessible tabs, dialog, tooltip, popover. Headless, ~5 KB each, only what we use
- **lucide-react** for icons (~tree-shaken)
- **Shiki** for syntax highlighting in code snippet tabs (small, accurate, supports many themes)
- **cmdk** for the Cmd+K command palette
- **wouter** for hash-based routing (~1 KB; we don't need full React Router)

No Redux/Jotai/Zustand needed — local state via `useState`/`useReducer`, theme via Context.

### Directory layout

```
packages-libs/docs/api-docs/
├── grest.package.ts
├── package.json
├── README.md
├── src/
│   ├── index-node.ts                   ← server-side entry: GGApiDocs, buildApiDocs, buildContractDoc
│   ├── GGApiDocs.ts                    ← live-mode HTTP route registration
│   ├── buildApiDocs.ts                 ← static-mode disk writer
│   ├── buildContractDoc.ts             ← contract → ApiDocsDocument
│   ├── docTypes.ts                     ← ApiDocsDocument types (used by both server and UI)
│   (no exporters.ts — api-docs is standalone, no openapi/asyncapi calls)
├── ui/
│   ├── package.json                    ← UI subpackage; not published; build only
│   ├── vite.config.ts
│   ├── index.html
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── routes.ts                   ← hash route definitions
│       ├── components/
│       │   ├── Layout.tsx              ← header / sidebar / pane
│       │   ├── Sidebar.tsx
│       │   ├── Header.tsx
│       │   ├── ExportMenu.tsx          ← OpenAPI / AsyncAPI / contract-doc downloads
│       │   ├── SearchPalette.tsx       ← cmdk-driven Cmd+K
│       │   ├── ThemeToggle.tsx
│       │   └── ServiceMap.tsx
│       ├── method/
│       │   ├── MethodView.tsx          ← top-level for one method
│       │   ├── MethodHeader.tsx        ← name, summary, badge
│       │   ├── MethodSignature.tsx     ← request/response visual
│       │   ├── PatternBadge.tsx        ← request/response, fire-and-forget, etc.
│       │   ├── tabs/
│       │   │   ├── CodeTab.tsx         ← TS client snippet, curl
│       │   │   ├── TestTab.tsx         ← mockOf + ctx.api recipe
│       │   │   └── TryItOutTab.tsx     ← live form + fetch (HTTP) or WS connect (WS)
│       │   └── ...
│       ├── schema/
│       │   ├── SchemaView.tsx          ← recursive renderer dispatching on SchemaDoc.type
│       │   ├── ObjectSchema.tsx
│       │   ├── ArraySchema.tsx
│       │   ├── UnionSchema.tsx
│       │   ├── DiscriminatedSchema.tsx
│       │   ├── PrimitiveSchema.tsx
│       │   ├── BrandBadge.tsx
│       │   └── ConstraintList.tsx
│       ├── error/
│       │   └── ErrorList.tsx           ← renders the typed-error-union pattern
│       ├── codegen/
│       │   ├── tsClient.ts             ← TS code generation
│       │   ├── curl.ts
│       │   ├── testRecipe.ts
│       │   └── highlight.tsx           ← Shiki wrapper
│       ├── tryout/
│       │   ├── HttpTryout.tsx
│       │   ├── WsTryout.tsx
│       │   ├── FormFromSchema.tsx      ← schema-driven input form
│       │   └── authStore.ts            ← localStorage token persistence
│       ├── theme/
│       │   ├── ThemeProvider.tsx
│       │   └── tokens.css              ← CSS custom properties
│       ├── hooks/
│       │   └── useDoc.ts               ← loads ApiDocsDocument from manifest URL
│       └── styles.css
└── dist-ui/                            ← Vite build output, committed, shipped
    ├── index.html
    ├── assets/
    │   ├── index-[hash].js
    │   └── index-[hash].css
    └── ...
```

The UI treats `ApiDocsDocument` as its sole input. It is loaded from `${docsPath}/api-docs.json` (live) or `./api-docs.json` (static).

### Build

`packages-libs/docs/api-docs/ui/package.json`:
```json
{
  "scripts": {
    "build": "vite build --emptyOutDir --outDir ../dist-ui"
  }
}
```

A repo-level script ensures the UI is built before package publish:
- Add `prepublishOnly` step or repo-level `grest.4.build.ts` hook to run the UI build for `@grest-ts/api-docs`.
- `dist-ui/` is committed (so consumers don't need to rebuild and so the npm tarball ships the built assets).

---

## Phase 3: Method rendering

The core of the UI. For each method:

### Layout

```
┌──────────────────────────────────────────────────────────┐
│ ← UserApi                                                │
│                                                          │
│  POST  /api/users  ┃ create                              │
│ ┃                                                        │
│ ┃  Creates a new user account.                           │
│ ┃                                                        │
│ ┃  ┌─────────────────────────────────────────────────┐   │
│ ┃  │ Request Body — CreateUserRequest                │   │
│ ┃  │   email: EmailAddress  (required)               │   │
│ ┃  │     "user@example.com"                          │   │
│ ┃  │   password: Password  (required)                │   │
│ ┃  │     8–128 chars                                 │   │
│ ┃  │   referralCode?: string                         │   │
│ ┃  └─────────────────────────────────────────────────┘   │
│ ┃                                                        │
│ ┃  ┌─────────────────────────────────────────────────┐   │
│ ┃  │ Response 200 — UserProfile                      │   │
│ ┃  │   id: UserId                                    │   │
│ ┃  │   email: EmailAddress                           │   │
│ ┃  │   createdAt: Timestamp                          │   │
│ ┃  └─────────────────────────────────────────────────┘   │
│ ┃                                                        │
│ ┃  ┌─────────────────────────────────────────────────┐   │
│ ┃  │ Errors                                          │   │
│ ┃  │   422  VALIDATION_ERROR  {field, message}       │   │
│ ┃  │   409  EMAIL_EXISTS                             │   │
│ ┃  │   500  SERVER_ERROR                             │   │
│ ┃  └─────────────────────────────────────────────────┘   │
│ ┃                                                        │
│ ┃  ┌─[Code]─[Test]─[Try it out]──────────────────────┐   │
│ ┃  │                                                 │   │
│ ┃  │   const client = UserApi.createClient()         │   │
│ ┃  │   const user = await client.create({            │   │
│ ┃  │     email: "user@example.com",                  │   │
│ ┃  │     password: "..."                             │   │
│ ┃  │   })                                            │   │
│ ┃  │                                                 │   │
│ ┃  └─────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### WS-specific layout

WS methods get a different header:
- Direction arrow: `← Server` for `server-to-client`, `→ Server` for `client-to-server`
- Pattern badge: "Request/Response" / "Fire-and-forget" / "Server Push" / "Server-initiated"
- For request/response: shows both inbound and outbound message shapes side-by-side

### Schema rendering details

`<SchemaView />` takes a `JsonSchemaDescription` (or a `SchemaRef` it resolves) and dispatches on `desc.node.kind` — the same `GGSchemaNodeKind` discriminated union grest-ts already exposes:

- **`string` / `number` / `integer` / `boolean` / `bit` / `password`** — type label + brand badge (when `docs.title` set) + constraint pill row + example
- **`object`** — collapsible property tree, required/optional indicator from `node.required[]`, descriptions inline
- **`array`** — `[ T ]` notation, `node.element` rendered recursively
- **`record`** — `Record<string, V>` notation, `node.value` recursive
- **`union`** — `A | B | C` with each `node.variants[]` branch expandable
- **`discriminated`** — tabs per variant from `node.variants[]`, `node.discriminator` field highlighted
- **`tuple`** — `[ A, B, C ]` with positional labels from `node.elements[]`
- **`literal`** — chip list of `node.values[]`
- **`file`** — file shape with `node.accept` / `node.maxSize` if present
- **`any` / `unknown`** — a small "any value" placeholder
- **$ref** — link to schema dictionary entry; clickable; renders inline preview on hover

Brand types render with a subtle badge built from `desc.docs.title` (e.g. `[Email Address]`) on a primitive node, with `desc.docs.format` (e.g. `email`, `uri`, `date`) shown as a small format hint. This is exactly how brand identity is represented at runtime in grest-ts (`.brand()` is a type-level operation only — runtime identity is the user-given `.docs({title})`), so what we render is what the framework actually has.

### Error display

Errors render as a list of cards, ordered by status code. Each card:
- Status code prominent (color-coded: 4xx orange, 5xx red)
- Error type name in code font
- Description if any
- Typed `data` schema rendered inline (collapsed by default, expand on click)

This is a feature OpenAPI tooling can't really show — typed error data is ours to surface.

---

## Phase 4: Code snippet tabs

Three tabs per method: **Code** / **Test** / **Try it out**.

### Code tab

Renders the typed grest-ts client call. Generated server-side... no, generated *client-side* in the UI (we have everything we need from the doc). Pseudo:

```typescript
function generateTsClient(method: MethodDoc, contract: ContractDoc): string {
    const args = buildArgsFromInput(method);
    const callShape = method.kind === "http"
        ? `await client.${method.name}(${args})`
        : `await client.${method.name}(${args})`;   // same shape, different transport
    return `const client = ${contract.name}.createClient()\nconst result = ${callShape}`;
}
```

Plus a curl alternative for HTTP (just `curl -X ${method} ${url}` with body). Plus a "Copy" button.

**Multi-language code samples for HTTP** (deferred to v1.1): pipe through `openapi-generator` for Python/Java/etc. *only* if the user explicitly clicks "Show in other languages" — lazy, not on initial render.

### Test tab

Generates the integration-test recipe directly from the contract:

```typescript
// In your test:
await ctx.users.create({email: "foo@bar.com", password: "..."})
    .toMatchObject({id: expect.any(String)})

// To mock, e.g. when testing a service that calls this:
mockOf(UserApi).create
    .toEqual({email: "foo@bar.com", password: "..."})
    .andReturn({id: "user_123", email: "foo@bar.com", createdAt: 0})
```

Pulls from contract structure plus a small templating layer. Educates users about the test pattern *while* documenting the API — uniquely grest-ts.

### Try It Out tab

Live interactive form:

**For HTTP:**
- `<FormFromSchema>` generates inputs from `requestBody`/`pathParams`/`queryParams`
  - String → text input (with min/max length validation)
  - Number → number input (with min/max)
  - Boolean → toggle
  - Enum → select
  - Object → nested form
  - Array → list with add/remove
  - Brand types → input with the brand's hint (email gets type=email, password gets type=password)
- Auth section: bearer token input persisted in `localStorage` (per docsPath, not global)
- "Send" button → constructs full URL, calls `fetch()`, displays response with syntax highlighting
- Response panel: status code + headers + JSON body
- Validation: client-side check against the input schema before sending (red error inline)

**For WS:**
- Top: "Connect to ws://..." button with auth header configurator
- Connection status indicator
- Per-method: form for `clientToServer` methods, "Send" button
- Live message log on the right: every message inbound/outbound with direction arrow, timestamp, JSON pretty-printed
- For request/response patterns: link the response back to the originating request via correlation
- Disconnect button

WS Try It Out is **uniquely useful** — there's no industry tool that does interactive typed WebSocket testing.

### Form generation

`<FormFromSchema schema={schemaRef}>` is the workhorse. Recursive component, dispatches on type, hands back values via controlled state. Output is a JS value matching the schema. Validates on submit using a lightweight schema-validator we ship in the doc (or, more pragmatically, just use the constraints in `SchemaDoc` to do client-side checking — the server validates anyway).

---

## Phase 5: Search

Cmd+K palette via `cmdk`. Indexes from the doc:
- Group names
- Contract names
- Method names + summaries + descriptions
- Named schemas
- Error type names

`Fuse.js` for fuzzy matching (~6 KB gzipped). Results show the type of match (`method`, `schema`, `error`) + a snippet. Selecting a result navigates via the same hash routing.

Hot key configurable through `branding.searchHotKey` (default `mod+k`).

---

## Phase 6: Service map (optional in v1)

A separate top-level view (`/service-map`) showing:
- One node per runtime
- Edges showing `Api.createClient()` relationships (which runtime calls which)
- Event-emit edges if `@grest-ts/events` is configured
- Clicking a node jumps into that runtime's contracts

Rendered via Mermaid — already used in the framework's own docs, no new dep.

The metadata for this needs to be captured in `compose()`. Options:
- Static analysis at build time (parse compose() — fragile)
- Runtime instrumentation: when `Api.createClient()` is called during compose, record it in a `GGServiceMapRecorder`
- Manual: user provides `serviceMap` explicitly

V1: **manual + simple runtime capture.** The user passes `serviceMap: ServiceMapDoc` directly when registering, OR can omit it. Future versions can auto-capture. Keep simple.

---

## Phase 7: Static build mode

`buildApiDocs({outDir, …})`:

```
${outDir}/
├── index.html                   ← copied from dist-ui/, with a script tag injecting the doc URL
├── api-docs.json                ← ApiDocsDocument JSON
├── openapi.json                 ← optional: written if any HTTP groups exist
├── asyncapi.json                ← optional: written if any WS groups exist
└── assets/
    ├── index-[hash].js          ← Vite bundle
    ├── index-[hash].css
    └── shiki-themes/            ← syntax highlighting themes
```

The shipped `dist-ui/index.html` references `./assets/...` — pure relative. Drops on S3 / Pages / anywhere.

Live mode serves the same files at `${docsPath}/api-docs.json`, `${docsPath}/index.html`, `${docsPath}/assets/*`, plus exporter routes for openapi/asyncapi (lazy).

---

## Phase 8: Live mode integration

`GGApiDocs.register({...})`:

```typescript
GGApiDocs.register({
    title: "MyOrg Platform",
    docsPath: "/docs",
    groups: {
        "Catalog":  {http: [ItemApi]},
        "Realtime": {ws: [ChatApiSchema]},
    },
    branding: {logoUrl: "/logo.svg", primaryColor: "#1d4ed8"},
})
```

Routes mounted:

| URL | Purpose |
|---|---|
| `GET /docs` | `dist-ui/index.html` |
| `GET /docs/api-docs.json` | `ApiDocsDocument` (lazy build, cached) |
| `GET /docs/assets/*` | Vite-built JS/CSS, served from `dist-ui/assets/` |

No openapi.json / asyncapi.json routes — those live in their own packages (`@grest-ts/openapi`, `@grest-ts/asyncapi`) which a user installs separately if they want them. api-docs is fully standalone.

`customUi` option still exists — receives the `ApiDocsDocument` and returns a full HTML string. Skips all asset routes.

---

## Phase 9: Polish

- **Themes**: light + dark + system. CSS custom properties; theme toggle in header.
- **Accessibility**: Radix primitives are accessible by default; add ARIA labels everywhere; keyboard nav works; color contrast WCAG AA.
- **Mobile**: sidebar collapses to drawer on narrow viewports.
- **Deep links**: `#/<group-slug>/<contract>/<method>` and `#/schemas/<name>` and `#/errors/<type>` and `#/service-map`.
- **Bundle size budget**: aim ≤400 KB gzipped for the whole thing. Real numbers will come from CI.
- **Loading states**: skeleton loaders while the doc fetches.
- **Errors**: clear "this group has no methods" / "manifest failed to load" states.

---

## Decisions locked in

| Decision | Rationale |
|---|---|
| Three peer packages — api-docs, openapi, asyncapi | api-docs renders contracts directly; openapi/asyncapi are exports for external tooling |
| api-docs depends on openapi/asyncapi only for export buttons | Decouple rendering from spec generation |
| React 19 + Vite + Tailwind + Radix + Shiki + cmdk | Stable, small, accessible, modern; no vendor lock-in |
| `ApiDocsDocument` wrapper format wraps the existing `GGSchemaDescription` | No bespoke schema type — schema portion is JSON-adapted `GGSchemaDescription` from `packages/schema/schema/src/GGSchemaDescription.ts`. Anyone who knows grest-ts schemas can read it; new node kinds added to grest-ts surface in the docs UI for free |
| Brand identity surfaced via `docs.title` + `docs.format` on primitive nodes | Matches how brand identity exists at runtime in grest-ts (`.brand()` is type-level only); same convention `@grest-ts/openapi` already uses — visual consistency between our UI and exported OpenAPI specs is automatic |
| WS interaction patterns as first-class enum | Renders honestly; doesn't flatten through send/receive/reply |
| Try It Out for both HTTP and WS | WS try-it-out is uniquely useful — no industry tool does it |
| Pre-built UI shipped in dist-ui/ | Users do not rebuild; dist-ui/ committed and published |
| dist-ui served at /docs/assets/* in live mode and ./assets/* in static | Same URL layout, different absolute prefix |
| api-docs is standalone — no dep on openapi/asyncapi | The two grouping models don't compose cleanly; keeping the standards exports as separate peer packages lets each align with its native shape |
| customUi receives ApiDocsDocument | User can build any UI around the standards-compliant internal doc |
| No backward compatibility with v1 | Free to redesign; v1 unreleased |

## Open decisions to revisit during implementation

- **Tailwind 4 vs vanilla CSS modules** — Tailwind for v1, but if bundle bloats, fall back to CSS modules with the same custom-property scheme.
- **Service map auto-capture** — manual in v1, runtime capture in v1.1 when stable hooks exist.
- **Multi-language code samples** — TS and curl in v1; other languages via lazy "show more" using openapi-generator-cli output, in v1.1.
- **i18n** — Out of scope v1. Hooks reserved (`branding.locale`).
- **Dark mode default** — follow `prefers-color-scheme` + manual override.

---

## Phased implementation order

1. **Format + generator** (Phase 1). No UI. Tests round-trip contracts → ApiDocsDocument. *Output: artifact others can write code against.*
2. **Server-side glue** — minimal `GGApiDocs.register()` that serves `api-docs.json` and a placeholder HTML. Lets us iterate on UI against a real running runtime.
3. **UI app skeleton** (Phase 2) — Vite/React/Tailwind/Radix bootstrap, layout, sidebar reads doc, empty pane.
4. **Method rendering** (Phase 3) — schema renderer, method header, request/response/errors panes. Read-only.
5. **Code/Test tabs** (Phase 4 partial) — TS client + curl + test recipe generators. No interactivity yet.
6. **Try It Out — HTTP** (Phase 4 cont.) — form generator, auth, fetch, response display.
7. **Try It Out — WS** (Phase 4 cont.) — connect, send, live message log.
8. **Search** (Phase 5).
9. **Static build mode** (Phase 7).
10. **OpenAPI/AsyncAPI export buttons** (Phase 8 cont.) — lazy routes, download menu.
11. **Service map** (Phase 6) — manual-only v1.
12. **Polish, themes, accessibility, mobile** (Phase 9).
13. **Bundle audit, perf pass, browser compat sweep**.
14. **Documentation rewrite** — `README-api-docs.md` and the api-docs/openapi/asyncapi READMEs.
15. **Showcase example** — replace the current `examples/grest-test/src/main.ts` unified-showcase block with a v2 demo.

Phases 1–4 are the riskiest; phases 6–10 are mostly "more of the same" once the foundation works. Worth a pause after Phase 4 (read-only doc complete) to evaluate before committing to Try It Out's complexity.

---

## Tradeoffs to be honest about

| Concern | Reality |
|---|---|
| Significantly more code than v1 | ~3000–5000 lines target, vs ~500 in v1 shell. Worth it because this is one of the framework's primary public surfaces. |
| Maintenance burden | Real. Mitigated by: bounded scope (read from one well-defined doc format), no dependency on external viewers' upgrade cycles, smaller dep surface than Swagger UI's React 16 internals. The schema portion of the format is `GGSchemaDescription`, owned and evolved by `@grest-ts/schema` — we don't maintain a parallel type system. |
| "Users expect Swagger UI" | They get it via `GGOpenApiDocs.register()`. The brand recognition argument doesn't disappear, it just stops being the default. |
| React adds runtime weight | ~50 KB gzipped for React 19 + ReactDOM. Tailwind adds maybe 10 KB. Total target ~250–400 KB still beats Swagger UI's ~500 KB and AsyncAPI react-component's ~1 MB. |
| Try It Out complexity | True. We have schemas (form gen), validators (client-side validation), and a known transport — more primitives than Swagger UI has, not fewer. |
| Reinvention risk | Mitigated by reusing `GGSchemaDescription` for the schema portion (same structure the openapi package already walks) — we invent the wrapper and rendering, not the schema data model. For everything else (syntax highlighting, accessibility primitives, search) we lean on solved libraries. |
| Scalar/Stoplight/etc. would be 80% there | True. But the 20% — typed errors, brand types, WS patterns, test recipes, typed client snippets, WS try-it-out — is the part that makes grest-ts docs *grest-ts*. |

---

## Files modified (summary)

| File | Change |
|------|--------|
| `packages-libs/docs/api-docs/grest.package.ts` | Drop `@asyncapi/react-component`, `@grest-ts/openapi`, and `@grest-ts/asyncapi` — api-docs is standalone |
| `packages-libs/docs/api-docs/src/GGApiDocs.ts` | Rewrite — serve dist-ui assets + api-docs.json + lazy openapi.json/asyncapi.json |
| `packages-libs/docs/api-docs/src/buildApiDocs.ts` | Rewrite — write dist-ui copy + api-docs.json + optional openapi.json/asyncapi.json |
| `packages-libs/docs/api-docs/src/manifest.ts` | Replaced by `buildContractDoc.ts` |
| `packages-libs/docs/api-docs/src/types.ts` | Replaced by `docTypes.ts` — wrapper-only types; schema portion reuses `GGSchemaDescription` from `@grest-ts/schema` |
| `examples/grest-test/src/main.ts` | Update unified-showcase block to v2 API |
| `README-api-docs.md` | Major rewrite — lead with api-docs as the "service portal", openapi/asyncapi as exports |
| `packages-libs/docs/openapi/README.md` | Reframe as "OpenAPI export for HTTP — for users who want OpenAPI tooling" |
| `packages-libs/docs/asyncapi/README.md` | Reframe as "AsyncAPI export for WS — for users who want AsyncAPI tooling" |

## Files removed

| File | Why |
|------|-----|
| `packages-libs/docs/api-docs/src/shell/index.html.ts` | Replaced by Vite-built UI |
| `packages-libs/docs/api-docs/src/shell/shellHtml.ts` | Replaced by Vite-built UI |
| `packages-libs/docs/api-docs/src/shell/assets.ts` | Replaced by `dist-ui/` references |
| `packages-libs/docs/api-docs/src/shell/assets/shell.{css,js}` | Replaced |

## Files created

A lot — see the `ui/` directory layout under Phase 2 and the codegen/render structure under Phases 3–5. Roughly:

- `src/buildContractDoc.ts` (~350 lines — thinner than originally estimated since the schema walker reuses `toSchemaDescription()` and the JSON adapter is a small recursive function)
- `src/docTypes.ts` (~80 lines — wrapper-only types; the schema portion is just `JsonSchemaDescription` plus the wrapping `ContractDoc`/`MethodDoc`/`ErrorDoc`/`AuthDoc`/etc.)
- `src/jsonSchemaAdapter.ts` (~50 lines — converts `GGSchemaDescription` ↔ `JsonSchemaDescription` by swapping schema/canonical references for stable IDs)
- `ui/src/main.tsx`, `App.tsx` (~100 lines combined)
- `ui/src/components/*` (~600 lines)
- `ui/src/method/*` (~800 lines, includes tabs and try-it-out)
- `ui/src/schema/*` (~700 lines, recursive renderer dispatching on `node.kind`)
- `ui/src/codegen/*` (~400 lines, snippet generators)
- `ui/src/tryout/*` (~600 lines, form gen + WS connection)
- `ui/src/theme/*`, `hooks/*`, `styles.css` (~200 lines)
- Tests across the board (~1500 lines)

Total target: **~5000 lines including tests**, of which ~3500 are new TypeScript/TSX and ~1500 are tests.

---

## Verification

1. `buildContractDoc` round-trip tests — every contract pattern produces correct doc structure.
2. Storybook (or simple Vite-served test pages) for each major UI component.
3. Component tests via Vitest + React Testing Library — schema rendering, form generation, code snippets.
4. Snapshot tests on generated TS client / curl / test snippets.
5. Live smoke test — boot showcase runtime, click through every API, verify Try It Out works against a real local request.
6. Bundle size CI check — fail if total UI bundle exceeds budget.
7. `examples/grest-test` end-to-end browser test (Playwright or just manual).

---

## Out of scope for v1

- Public plugin API for third-party renderers (would lock our internals before they stabilize)
- Multi-language code samples (TS + curl only)
- i18n
- Auto-discovery of contract packages (`scan node_modules`)
- Live API performance metrics / latency overlays
- Versioned docs UI (`/docs/v1`, `/docs/v2`) — possible but defer
- Markdown rendering for descriptions (start with plain text; markdown in v1.1 if needed — `description` already supports it in the format)
- "Edit and re-deploy" — we are read-only, period.
