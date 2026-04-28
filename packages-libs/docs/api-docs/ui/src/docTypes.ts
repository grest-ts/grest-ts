/**
 * ApiDocsDocument types — kept in sync with examples/api-docs-v2/src/docTypes.ts
 * Copied here so the UI is a self-contained app (no cross-package imports).
 */

export interface ApiDocsDocument {
    version: "1.0";
    service: ServiceDoc;
    groups: GroupDoc[];
    schemas: Record<string, NamedSchemaDoc>;
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
    pathPrefix?: string;
    path?: string;
    description?: string;
    auth?: AuthDoc[];
    /** Non-auth transport headers declared by middleware (bearer/api-key live in `auth`). */
    headers?: ParamDoc[];
    methods: MethodDoc[];
}

export interface MethodDoc {
    name: string;
    summary?: string;
    description?: string;

    httpMethod?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    httpPath?: string;
    pathParams?: ParamDoc[];
    queryParams?: ParamDoc[];
    requestBody?: SchemaRef;
    responseHeaders?: Record<string, SchemaRef>;

    wsDirection?: "client-to-server" | "server-to-client";
    wsPattern?: "request-response" | "fire-and-forget" | "server-push" | "server-initiated-request";
    wsInput?: SchemaRef;

    successResponse?: SchemaRef;
    errors: string[];

    deprecated?: boolean;
    deprecationMessage?: string;
}

export interface ParamDoc {
    name: string;
    schema: SchemaRef;
    required: boolean;
    description?: string;
}

export type SchemaRef =
    | { ref: string }
    | { inline: JsonSchemaDescription };

export interface JsonSchemaDescription {
    canonicalId: string;
    node: JsonSchemaNodeKind;
    docs?: GGSchemaDocs;
    defaultValue?: unknown;
    nullable: boolean;
    optional: boolean;
}

export interface GGSchemaDocs {
    title?: string;
    description?: string;
    example?: unknown;
    examples?: readonly unknown[];
    deprecated?: boolean;
    format?: string;
    /** Runtime form of the TypeScript brand (e.g. "UserId" from `.brand("UserId")`). */
    brand?: string;
}

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

export interface NamedSchemaDoc {
    title: string;
    description?: string;
    schema: JsonSchemaDescription;
    usedIn?: SchemaUsage[];
}

export interface SchemaUsage {
    contract: string;
    method: string;
    location: "input" | "success" | "error" | "property";
}

export interface ErrorDoc {
    type: string;
    statusCode: number;
    description?: string;
    data?: SchemaRef;
    usedIn?: ErrorUsage[];
}

export interface ErrorUsage {
    contract: string;
    method: string;
}

export interface AuthDoc {
    scheme: "bearer" | "api-key";
    headerName: string;
    description?: string;
}

export interface BrandingDoc {
    logoUrl?: string;
    primaryColor?: string;
    fontFamily?: string;
}

/**
 * Runtime config injected as `window.GG_API_DOCS_CONFIG` by GGApiDocs
 * (live) and buildApiDocs (static). Tells the UI which docs to expose
 * in the dropdown and where to fetch each one.
 *
 * Order = dropdown order; first entry is the default.
 */
export interface ApiDocsConfig {
    docs: ApiDocsConfigEntry[];
}

export interface ApiDocsConfigEntry {
    slug: string;
    title: string;
    url: string;
}
