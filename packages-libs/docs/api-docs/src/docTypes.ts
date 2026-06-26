/**
 * ApiDocsDocument — the JSON shape the api-docs UI renders.
 *
 * Schema portion is `JsonSchemaDescription` — a JSON-safe view of
 * grest-ts's existing `GGSchemaDescription` (defined in
 * `packages/schema/schema/src/GGSchemaDescription.ts`). The wrapper
 * (service/groups/contracts/methods/errors) is invented here.
 */

import type {GGSchemaNodeKind, GGSchemaDescription} from "@grest-ts/schema";
import type {GGSchemaDocs} from "@grest-ts/schema";

// ── Schema layer ───────────────────────────────────────────────────────

/**
 * JSON-safe view of `GGSchemaDescription`. Identical structure except:
 * - `schema` and `canonical` (which are GGSchema instance refs in the
 *   in-memory format) are replaced with stable string IDs.
 * - Nested descriptions inside `node` are recursively `JsonSchemaDescription`.
 *
 * The `node` discriminator and `docs` annotations are preserved verbatim,
 * so anything that walks `GGSchemaDescription` via `node.kind` works the
 * same way over `JsonSchemaDescription`.
 */
export interface JsonSchemaDescription {
    /** Stable ID derived from the originating GGSchema (canonical when set, else self). */
    canonicalId: string;

    /** Structural content — same union as `GGSchemaNodeKind`, with nested descriptions
     *  converted to `JsonSchemaDescription`. */
    node: JsonSchemaNodeKind;

    docs?: GGSchemaDocs;
    defaultValue?: unknown;
    nullable: boolean;
    optional: boolean;
}

/** Mirrors `GGSchemaNodeKind` but with nested descriptions JSON-adapted. */
export type JsonSchemaNodeKind =
    | { kind: 'string'; minLength?: number; maxLength?: number; pattern?: string }
    | { kind: 'number'; integer: boolean; min?: number; max?: number; multipleOf?: number }
    | { kind: 'boolean' }
    | { kind: 'bit' }
    | { kind: 'literal'; values: readonly (string | number | boolean)[] }
    | { kind: 'array'; element: JsonSchemaDescription; minItems?: number; maxItems?: number }
    | { kind: 'object'; properties: Record<string, JsonSchemaDescription>; required: string[]; additionalProperties: false }
    | { kind: 'record'; value: JsonSchemaDescription }
    | { kind: 'union'; variants: JsonSchemaDescription[] }
    | { kind: 'discriminated'; discriminator: string; variants: JsonSchemaDescription[] }
    | { kind: 'tuple'; elements: JsonSchemaDescription[] }
    | { kind: 'any' }
    | { kind: 'unknown' }
    | { kind: 'file'; accept?: readonly string[]; maxSize?: number }
    | { kind: 'password'; minLength: number; maxLength: number };

// Re-export for caller convenience.
export type { GGSchemaNodeKind, GGSchemaDescription, GGSchemaDocs };

/** Reference into the shared schema dictionary OR an inline schema description. */
export type SchemaRef =
    | { ref: string }                        // → document.schemas[ref]
    | { inline: JsonSchemaDescription };

// ── Document wrapper ───────────────────────────────────────────────────

export interface ApiDocsDocument {
    /** Format version. Bumps on breaking changes. */
    version: "1.0";

    service: ServiceDoc;
    groups: GroupDoc[];

    /** Named schemas extracted by canonical title. */
    schemas: Record<string, NamedSchemaDoc>;

    /** Every error class encountered, keyed by ERROR.TYPE. */
    errors: Record<string, ErrorDoc>;

    branding?: BrandingDoc;
}

export interface ServiceDoc {
    name: string;
    version?: string;
    description?: string;
    runtimes?: string[];
}

export interface GroupDoc {
    name: string;
    slug: string;
    description?: string;
    contracts: ContractDoc[];
}

export interface ContractDoc {
    name: string;
    kind: "http" | "ws";

    /** HTTP only. */
    pathPrefix?: string;
    /** WS only. */
    path?: string;

    description?: string;
    /**
     * Auth schemes the transport middleware declares (security UX in the UI —
     * "Authorize" buttons, lock icons). Populated only when a header schema
     * carries `format: "bearer"` or `format: "api-key"`.
     */
    auth?: AuthDoc[];
    /**
     * Other transport headers declared by middleware on the schema — the
     * non-auth ones. Each carries the same metadata as a query/path param
     * (name, schema, required, description). Authentication headers are
     * intentionally excluded; they live in `auth` to drive different UI.
     */
    headers?: ParamDoc[];
    /**
     * Cookies the transport middleware reads (via a cookie() binding). Surfaced so a
     * reader can see, without any hand-written docs, that e.g. a `session` cookie exists
     * and how a cookie-based flow (auth, locale) reaches the API. Populated from the
     * binding's declared cookie name + value schema.
     */
    cookies?: ParamDoc[];
    /** WS only — populated when the contract declares `connect.permission`. */
    connectPermission?: PermissionDoc;
    methods: MethodDoc[];
}

export type PermissionTree =
    | {kind: "public"}
    | {kind: "anyAuth"}
    | {kind: "scope"; scope: string}
    | {kind: "allOf"; children: PermissionTree[]}
    | {kind: "anyOf"; children: PermissionTree[]};

/**
 * Renders contract-declared permission into both a human-readable form (for
 * the UI) and a structured tree (for tooling).
 */
export interface PermissionDoc {
    /**
     * Plain-English rendering: "Public — no authentication required",
     * "Any authenticated identity", "Requires `items:write` and `admin`", etc.
     */
    text: string;
    /** Structured tree mirroring GGPermission. */
    tree: PermissionTree;
}

export interface MethodDoc {
    name: string;
    summary?: string;
    description?: string;

    // ── HTTP-specific ──
    httpMethod?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    /** Full path with :params, e.g. "/api/users/:id". */
    httpPath?: string;
    pathParams?: ParamDoc[];
    /** GET/DELETE-only — input fields rendered as query params. */
    queryParams?: ParamDoc[];
    /** POST/PUT-only — input rendered as request body. */
    requestBody?: SchemaRef;
    responseHeaders?: Record<string, SchemaRef>;

    // ── WS-specific ──
    wsDirection?: "client-to-server" | "server-to-client";
    wsPattern?: "request-response" | "fire-and-forget" | "server-push" | "server-initiated-request";
    wsInput?: SchemaRef;
    /** Raw byte-stream socket connect — no per-message contract. `customClient` ⇒ foreign-client HTTP upgrade. */
    wsByteStream?: {customClient: boolean};

    // ── Shared ──
    /** Response shape on success; absent ⇒ void. */
    successResponse?: SchemaRef;
    /** Keys into `document.errors`. */
    errors: string[];

    deprecated?: boolean;
    deprecationMessage?: string;

    /**
     * Contract-declared permission. The framework gate enforces this BEFORE
     * the handler runs — see plan §7 for the "endpoint access vs resource
     * access" boundary.
     */
    permission?: PermissionDoc;
}

export interface ParamDoc {
    name: string;
    schema: SchemaRef;
    required: boolean;
    description?: string;
}

export interface NamedSchemaDoc {
    title: string;
    description?: string;
    schema: JsonSchemaDescription;
    /** Where this schema is referenced — back-refs for the schema detail page. */
    usedIn?: SchemaUsage[];
}

export interface SchemaUsage {
    contract: string;
    method: string;
    location: "input" | "success" | "error" | "property";
}

export interface ErrorDoc {
    type: string;          // "VALIDATION_ERROR"
    statusCode: number;
    description?: string;
    data?: SchemaRef;      // typed error payload, when defined
    usedIn?: ErrorUsage[];
}

export interface ErrorUsage {
    contract: string;
    method: string;
}

export interface AuthDoc {
    /** Two values only. `"bearer"` is the RFC 6750 form (Authorization:
     *  Bearer <token>) and gets dedicated tooling support. `"header"` is
     *  the catch-all for every other auth header — OpenAPI-style api
     *  keys, session bindings, tenant hints, custom tokens — anything
     *  declared with `format: "api-key"` or `format: "auth"`. */
    scheme: "bearer" | "header";
    headerName: string;
    description?: string;
}

export interface BrandingDoc {
    logoUrl?: string;
    primaryColor?: string;
    fontFamily?: string;
}

// ── Window-injected config ─────────────────────────────────────────────

/**
 * Runtime config injected as `window.GG_API_DOCS_CONFIG` by both
 * `GGApiDocs` (live) and `buildApiDocs` (static). Tells the React UI
 * which documents are available and where to fetch each one.
 *
 * Order = dropdown order; first entry is the default selection.
 */
export interface ApiDocsConfig {
    docs: ApiDocsConfigEntry[];
}

export interface ApiDocsConfigEntry {
    /** URL slug — must be unique within `docs[]`; used in hash routes. */
    slug: string;
    /** Human-readable title shown in the dropdown. */
    title: string;
    /** Absolute or relative URL to the contract document JSON. */
    url: string;
}
