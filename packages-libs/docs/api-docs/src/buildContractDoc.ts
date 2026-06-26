/**
 * buildContractDoc — turns grest-ts HTTP and WebSocket schemas into the
 * `ApiDocsDocument` JSON consumed by the api-docs UI.
 *
 * Walks contracts, classifies methods (HTTP verbs / WS patterns), extracts
 * named schemas via canonical identity (same dedup logic SchemaRegistry uses
 * in @grest-ts/openapi), collects every error class, builds the wrapper.
 *
 * The schema portion delegates to `JsonSchemaAdapter` which JSON-adapts
 * `GGSchemaDescription` from grest-ts/schema — we don't reinvent the schema
 * model.
 */

import type {GGHttpSchema} from "@grest-ts/http";
import type {GGHeaderSchema, GGTransportMiddleware} from "@grest-ts/context";
import type {GGWebSocketSchema, GGRawWebSocketSchema} from "@grest-ts/websocket";
import type {ANY_ERROR_CLS, GGPermission, GGSchema} from "@grest-ts/schema";
import {GG_ANY_PERMISSION, GG_NO_PERMISSIONS} from "@grest-ts/schema";
import {JsonSchemaAdapter} from "./jsonSchemaAdapter";
import type {
    ApiDocsDocument, AuthDoc, ContractDoc, ErrorDoc, GroupDoc,
    JsonSchemaDescription, MethodDoc, NamedSchemaDoc, ParamDoc, PermissionDoc, PermissionTree, SchemaRef,
    SchemaUsage,
} from "./docTypes";

export interface BuildContractDocOptions {
    title: string;
    version?: string;
    description?: string;
    runtimes?: string[];

    /** Group label → schemas in that group. Each can have HTTP, WS, or both. */
    groups: Record<string, {
        http?: GGHttpSchema<any>[];
        ws?: (GGWebSocketSchema<any> | GGRawWebSocketSchema<any>)[];
        description?: string;
    }>;

    branding?: ApiDocsDocument["branding"];
}

interface BuildContext {
    adapter: JsonSchemaAdapter;
    schemas: Map<string, NamedSchemaDoc>;        // title → NamedSchemaDoc
    errors: Map<string, ErrorDoc>;               // type → ErrorDoc
    schemaUsages: Map<string, SchemaUsage[]>;    // title → usages
    errorUsages: Map<string, ErrorDoc["usedIn"]>;
}

export function buildContractDoc(options: BuildContractDocOptions): ApiDocsDocument {
    const ctx: BuildContext = {
        adapter: new JsonSchemaAdapter(),
        schemas: new Map(),
        errors: new Map(),
        schemaUsages: new Map(),
        errorUsages: new Map(),
    };

    const groups: GroupDoc[] = [];
    const usedSlugs = new Set<string>();

    for (const [groupName, group] of Object.entries(options.groups)) {
        const slug = toSlug(groupName);
        if (usedSlugs.has(slug)) {
            throw new Error(`buildContractDoc: duplicate slug "${slug}" — rename groups to disambiguate.`);
        }
        usedSlugs.add(slug);

        const contracts: ContractDoc[] = [];
        for (const httpSchema of group.http ?? []) {
            contracts.push(buildHttpContract(httpSchema, ctx));
        }
        for (const wsSchema of group.ws ?? []) {
            contracts.push(buildWsContract(wsSchema, ctx));
        }

        groups.push({
            name: groupName,
            slug,
            ...(group.description ? {description: group.description} : {}),
            contracts,
        });
    }

    // Attach back-references on schemas and errors.
    for (const [title, schema] of ctx.schemas) {
        const usages = ctx.schemaUsages.get(title);
        if (usages && usages.length > 0) schema.usedIn = usages;
    }
    for (const [type, err] of ctx.errors) {
        const usages = ctx.errorUsages.get(type);
        if (usages && usages.length > 0) err.usedIn = usages;
    }

    return {
        version: "1.0",
        service: {
            name: options.title,
            ...(options.version ? {version: options.version} : {}),
            ...(options.description ? {description: options.description} : {}),
            ...(options.runtimes ? {runtimes: options.runtimes} : {}),
        },
        groups,
        schemas: Object.fromEntries(ctx.schemas),
        errors: Object.fromEntries(ctx.errors),
        ...(options.branding ? {branding: options.branding} : {}),
    };
}

// ── HTTP contract ──────────────────────────────────────────────────────

function buildHttpContract(httpSchema: GGHttpSchema<any>, ctx: BuildContext): ContractDoc {
    const auth = extractHttpAuth(httpSchema.apiMiddlewares as readonly GGTransportMiddleware[]);
    const headers = extractHttpHeaders(httpSchema.apiMiddlewares as readonly GGTransportMiddleware[], ctx, httpSchema.name);
    const cookies = extractCookies(httpSchema.apiMiddlewares as readonly GGTransportMiddleware[], ctx, httpSchema.name);
    const methods: MethodDoc[] = [];

    for (const methodName of Object.keys(httpSchema.codec)) {
        const codec = httpSchema.codec[methodName];
        const contract = httpSchema.contract?.methods[methodName];
        if (!codec || !contract) continue;

        methods.push(buildHttpMethod(methodName, codec, contract, httpSchema.name, ctx));
    }

    return {
        name: httpSchema.name,
        kind: "http",
        pathPrefix: normalizePath(httpSchema.pathPrefix),
        ...(auth.length > 0 ? {auth} : {}),
        ...(headers.length > 0 ? {headers} : {}),
        ...(cookies.length > 0 ? {cookies} : {}),
        methods,
    };
}

function buildHttpMethod(
    methodName: string,
    codec: { method: string; path: string },
    contract: { input?: GGSchema<any>; success?: GGSchema<any>; errors?: ANY_ERROR_CLS[]; permission?: GGPermission },
    contractName: string,
    ctx: BuildContext,
): MethodDoc {
    const httpMethod = codec.method.toUpperCase() as MethodDoc["httpMethod"];
    const fullPath = "/" + (codec.path ? codec.path.replace(/^\/+/, "") : "");
    const pathParamNames = extractPathParams(codec.path);

    const method: MethodDoc = {
        name: methodName,
        summary: camelToTitle(methodName),
        httpMethod,
        httpPath: fullPath,
        errors: collectErrors(contract.errors, contractName, methodName, ctx),
        ...(contract.permission !== undefined ? {permission: buildPermissionDoc(contract.permission)} : {}),
    };

    // Input handling — split by HTTP verb.
    if (contract.input) {
        const inputDesc = contract.input.toSchemaDescription();
        const isObject = inputDesc.node.kind === "object";
        const usesBody = httpMethod === "POST" || httpMethod === "PUT" || httpMethod === "PATCH";

        if (isObject && pathParamNames.length > 0) {
            // Pull path params out of the object input
            const inputObject = inputDesc.node as Extract<typeof inputDesc.node, {kind: "object"}>;
            const pathParams: ParamDoc[] = [];
            const remainingProps: typeof inputObject.properties = {};
            for (const [name, propDesc] of Object.entries(inputObject.properties)) {
                if (pathParamNames.includes(name)) {
                    pathParams.push({
                        name,
                        schema: schemaRefFor(propDesc, contractName, methodName, "input", ctx),
                        required: inputObject.required.includes(name),
                    });
                } else {
                    remainingProps[name] = propDesc;
                }
            }
            if (pathParams.length > 0) method.pathParams = pathParams;

            if (Object.keys(remainingProps).length > 0) {
                if (usesBody) {
                    method.requestBody = inlineObjectRef(remainingProps, inputObject.required, contract.input, contractName, methodName, ctx);
                } else {
                    method.queryParams = Object.entries(remainingProps).map(([name, propDesc]) => ({
                        name,
                        schema: schemaRefFor(propDesc, contractName, methodName, "input", ctx),
                        required: inputObject.required.includes(name),
                    }));
                }
            }
        } else if (usesBody) {
            method.requestBody = schemaRefFor(inputDesc, contractName, methodName, "input", ctx);
        } else if (isObject) {
            const inputObject = inputDesc.node as Extract<typeof inputDesc.node, {kind: "object"}>;
            method.queryParams = Object.entries(inputObject.properties).map(([name, propDesc]) => ({
                name,
                schema: schemaRefFor(propDesc, contractName, methodName, "input", ctx),
                required: inputObject.required.includes(name),
            }));
        }
    }

    if (contract.success) {
        method.successResponse = schemaRefFor(contract.success.toSchemaDescription(), contractName, methodName, "success", ctx);
    }

    return method;
}

// ── WS contract ────────────────────────────────────────────────────────

function buildWsContract(
    wsSchema: GGWebSocketSchema<any> | GGRawWebSocketSchema<any>,
    ctx: BuildContext,
): ContractDoc {
    const wsMiddlewares: any[] = (wsSchema as any).middlewares ?? [];
    const auth = extractWsAuth(wsMiddlewares);
    const headers = extractWsHeaders(wsMiddlewares, ctx, wsSchema.name);
    const cookies = extractCookies(wsMiddlewares, ctx, wsSchema.name);
    const methods: MethodDoc[] = [];

    // Raw byte-stream schemas (`raw: true`) carry no per-message contract — only `connect`.
    // The narrowing reaches `.contract.clientToServer` safely; raw schemas render as a single
    // synthetic `connect` method so the byte stream is still visible in the method-driven UI.
    if ("raw" in wsSchema) {
        methods.push(buildRawConnectMethod(wsSchema, ctx));
    } else {
        const contract = wsSchema.contract;
        for (const methodName of Object.keys(contract.clientToServer.methods)) {
            const m = contract.clientToServer.methods[methodName];
            methods.push(buildWsMethod(methodName, m, "client-to-server", wsSchema.name, ctx));
        }
        for (const methodName of Object.keys(contract.serverToClient.methods)) {
            const m = contract.serverToClient.methods[methodName];
            methods.push(buildWsMethod(methodName, m, "server-to-client", wsSchema.name, ctx));
        }
    }

    const connectPerm = wsSchema.contract.connect.method.permission;
    const connectPermission = connectPerm !== undefined
        ? buildPermissionDoc(connectPerm)
        : undefined;
    return {
        name: wsSchema.name,
        kind: "ws",
        path: "/" + wsSchema.path.replace(/^\/+/, ""),
        ...(auth.length > 0 ? {auth} : {}),
        ...(headers.length > 0 ? {headers} : {}),
        ...(cookies.length > 0 ? {cookies} : {}),
        ...(connectPermission ? {connectPermission} : {}),
        methods,
    };
}

function buildWsMethod(
    methodName: string,
    contract: { input?: GGSchema<any>; success?: GGSchema<any>; errors?: ANY_ERROR_CLS[]; permission?: GGPermission },
    direction: "client-to-server" | "server-to-client",
    contractName: string,
    ctx: BuildContext,
): MethodDoc {
    const hasReply = contract.success != null || (contract.errors && contract.errors.length > 0);
    let pattern: MethodDoc["wsPattern"];
    if (direction === "client-to-server") {
        pattern = hasReply ? "request-response" : "fire-and-forget";
    } else {
        pattern = hasReply ? "server-initiated-request" : "server-push";
    }

    // Server-pushed messages have no caller identity for the gate to check, so
    // the permission field on those is documentation-only — render it only for
    // c2s methods to avoid surfacing a meaningless requirement on s2c pushes.
    const includePermission = direction === "client-to-server" && contract.permission !== undefined;

    const method: MethodDoc = {
        name: methodName,
        summary: camelToTitle(methodName),
        wsDirection: direction,
        wsPattern: pattern,
        errors: collectErrors(contract.errors, contractName, methodName, ctx),
        ...(includePermission ? {permission: buildPermissionDoc(contract.permission!)} : {}),
    };

    if (contract.input) {
        method.wsInput = schemaRefFor(contract.input.toSchemaDescription(), contractName, methodName, "input", ctx);
    }
    if (contract.success) {
        method.successResponse = schemaRefFor(contract.success.toSchemaDescription(), contractName, methodName, "success", ctx);
    }
    return method;
}

/**
 * Raw byte-stream sockets have no message contract, so they render as a single `connect`
 * method: the handshake's query input + connect errors, with a note that the body is an
 * opaque byte stream (and whether it's a foreign `customClient` upgrade).
 */
function buildRawConnectMethod(wsSchema: GGRawWebSocketSchema<any>, ctx: BuildContext): MethodDoc {
    const connect = wsSchema.contract.connect.method;
    const customClient = wsSchema.customClient;
    const method: MethodDoc = {
        name: "connect",
        summary: "Connect (raw byte stream)",
        description: customClient
            ? "Opaque byte-stream socket for a foreign client — auth runs at the HTTP upgrade (no grest-ts handshake), then the application owns the wire."
            : "Opaque byte-stream socket — once connected, the application owns the wire as raw bytes (no per-message contract).",
        wsByteStream: {customClient},
        errors: collectErrors(connect.errors, wsSchema.name, "connect", ctx),
    };
    if (connect.input) {
        method.wsInput = schemaRefFor(connect.input.toSchemaDescription(), wsSchema.name, "connect", "input", ctx);
    }
    return method;
}

// ── Schema extraction ──────────────────────────────────────────────────

/** Return a SchemaRef. If the schema has a docs.title, extract it into the schema dictionary. */
function schemaRefFor(
    desc: import("@grest-ts/schema").GGSchemaDescription,
    contractName: string,
    methodName: string,
    location: SchemaUsage["location"],
    ctx: BuildContext,
): SchemaRef {
    const base = desc.canonical ?? desc.schema;
    const title = base.def?.docs?.title;
    if (title) {
        // Extract once, return $ref for subsequent uses.
        if (!ctx.schemas.has(title)) {
            const baseDesc = base.toSchemaDescription();
            const baseDocs = base.def?.docs;
            ctx.schemas.set(title, {
                title,
                ...(baseDocs?.description ? {description: baseDocs.description} : {}),
                schema: ctx.adapter.convert(baseDesc),
            });
        }
        recordSchemaUsage(title, contractName, methodName, location, ctx);
        return {ref: title};
    }
    return {inline: ctx.adapter.convert(desc)};
}

/** Record that a schema is used by a particular method. */
function recordSchemaUsage(
    title: string,
    contractName: string,
    methodName: string,
    location: SchemaUsage["location"],
    ctx: BuildContext,
): void {
    let arr = ctx.schemaUsages.get(title);
    if (!arr) {
        arr = [];
        ctx.schemaUsages.set(title, arr);
    }
    arr.push({contract: contractName, method: methodName, location});
}

/** Used when we strip path-param fields out of an input object — re-wrap the remainder. */
function inlineObjectRef(
    remainingProps: Record<string, import("@grest-ts/schema").GGSchemaDescription>,
    required: string[],
    originalSchema: GGSchema<any>,
    contractName: string,
    methodName: string,
    ctx: BuildContext,
): SchemaRef {
    // Inline only — synthetic shape, no canonical identity worth preserving.
    const properties: Record<string, JsonSchemaDescription> = {};
    for (const [k, v] of Object.entries(remainingProps)) {
        properties[k] = ctx.adapter.convert(v);
    }
    return {
        inline: {
            canonicalId: `s-inline-${contractName}-${methodName}`,
            node: {
                kind: "object",
                properties,
                required: required.filter(r => r in remainingProps),
                additionalProperties: false,
            },
            nullable: false,
            optional: false,
        },
    };
}

// ── Errors ─────────────────────────────────────────────────────────────

function collectErrors(
    errors: ANY_ERROR_CLS[] | undefined,
    contractName: string,
    methodName: string,
    ctx: BuildContext,
): string[] {
    if (!errors) return [];
    const types: string[] = [];
    for (const errCls of errors) {
        const type = errCls.TYPE;
        types.push(type);

        if (!ctx.errors.has(type)) {
            const doc: ErrorDoc = {
                type,
                statusCode: errCls.STATUS_CODE,
            };
            if (errCls.schema) {
                doc.data = schemaRefFor((errCls.schema as GGSchema<any>).toSchemaDescription(), contractName, methodName, "error", ctx);
            }
            ctx.errors.set(type, doc);
        }

        let arr = ctx.errorUsages.get(type);
        if (!arr) {
            arr = [];
            ctx.errorUsages.set(type, arr);
        }
        arr.push({contract: contractName, method: methodName});
    }
    return types;
}

// ── Auth ───────────────────────────────────────────────────────────────

function extractHttpAuth(middlewares: readonly GGTransportMiddleware[]): AuthDoc[] {
    const auth: AuthDoc[] = [];
    for (const mw of middlewares) {
        for (const [name, schema] of Object.entries(mw.headers ?? {})) {
            const desc = schema.toSchemaDescription();
            const scheme = authSchemeFromFormat(desc.docs?.format);
            if (scheme) {
                auth.push({scheme, headerName: name, ...(desc.docs?.description ? {description: desc.docs.description} : {})});
            }
        }
    }
    return auth;
}

function extractWsAuth(middlewares: any[]): AuthDoc[] {
    // WS middleware shape: { headers: {...} }
    const auth: AuthDoc[] = [];
    for (const mw of middlewares) {
        for (const [name, schema] of Object.entries(mw.headers ?? {}) as [string, any][]) {
            const desc = schema.toSchemaDescription?.();
            const scheme = authSchemeFromFormat(desc?.docs?.format);
            if (scheme) {
                auth.push({scheme, headerName: name, ...(desc.docs?.description ? {description: desc.docs.description} : {})});
            }
        }
    }
    return auth;
}

/**
 * Map a header schema's `format` hint to its auth scheme, or undefined
 * if the header isn't part of the auth surface.
 *
 * Only two schemes:
 *   - `"bearer"` — RFC 6750 `Authorization: Bearer <token>`. Specific
 *     wire format, recognised by tooling (Swagger Authorize, etc).
 *   - `"header"` — every other auth header. Covers OpenAPI-style
 *     api-keys (`format: "api-key"`), session bindings / tenant hints
 *     / paired identifiers (`format: "auth"`), and any other custom
 *     header that belongs visually under Authentication but isn't a
 *     Bearer token. The pill carries no protocol claim — only "this
 *     header is part of the auth surface."
 *
 * The `"api-key"` format input is preserved for backward compat and
 * because OpenAPI/AsyncAPI emit still keys off it to choose the right
 * security scheme shape (`apiKey` vs `http: bearer`). The api-docs UI
 * doesn't need that distinction — both render as `[HEADER]`.
 */
function authSchemeFromFormat(format: string | undefined): AuthDoc["scheme"] | undefined {
    if (format === "bearer") return "bearer";
    if (format === "api-key" || format === "auth") return "header";
    return undefined;
}

// ── Non-auth headers ───────────────────────────────────────────────────
//
// Mirror of extract*Auth, but for everything that ISN'T a bearer/api-key
// header. Useful for surfacing transport headers like Idempotency-Key,
// Accept-Language, X-Request-Id — middleware-declared headers that don't
// belong in the security UX but are still part of the contract a caller
// needs to know about.

function extractHttpHeaders(
    middlewares: readonly GGTransportMiddleware[],
    ctx: BuildContext,
    contractName: string,
): ParamDoc[] {
    const out: ParamDoc[] = [];
    for (const mw of middlewares) {
        for (const [name, schema] of Object.entries(mw.headers ?? {})) {
            const desc = schema.toSchemaDescription();
            const format = desc.docs?.format;
            if (authSchemeFromFormat(format) !== undefined) continue; // → goes to `auth`
            out.push(toHeaderParam(name, schema, desc, ctx, contractName));
        }
    }
    return out;
}

function extractWsHeaders(
    middlewares: any[],
    ctx: BuildContext,
    contractName: string,
): ParamDoc[] {
    const out: ParamDoc[] = [];
    for (const mw of middlewares) {
        for (const [name, schema] of Object.entries(mw.headers ?? {}) as [string, any][]) {
            const desc = schema.toSchemaDescription?.();
            if (!desc) continue;
            const format = desc.docs?.format;
            if (authSchemeFromFormat(format) !== undefined) continue;
            out.push(toHeaderParam(name, schema, desc, ctx, contractName));
        }
    }
    return out;
}

// ── Cookies ────────────────────────────────────────────────────────────
//
// cookie() bindings (HTTP and WS share the same binding object) expose their
// read cookie as `cookieParams: {name → value schema}`. Surfaced as its own
// section so a cookie-based flow — e.g. an `access` session cookie — is visible
// in the docs without anyone writing prose about it.

function extractCookies(
    middlewares: readonly {cookieParams?: Record<string, GGHeaderSchema>}[],
    ctx: BuildContext,
    contractName: string,
): ParamDoc[] {
    const out: ParamDoc[] = [];
    for (const mw of middlewares) {
        for (const [name, schema] of Object.entries(mw.cookieParams ?? {})) {
            const desc = schema.toSchemaDescription?.();
            if (!desc) continue;
            out.push(toHeaderParam(name, schema, desc, ctx, contractName));
        }
    }
    return out;
}

function toHeaderParam(
    name: string,
    _schema: GGHeaderSchema,
    desc: import("@grest-ts/schema").GGSchemaDescription,
    ctx: BuildContext,
    contractName: string,
): ParamDoc {
    return {
        name,
        schema: schemaRefFor(desc, contractName, "$headers", "input", ctx),
        required: !desc.optional,
        ...(desc.docs?.description ? {description: desc.docs.description} : {}),
    };
}

// ── Helpers ────────────────────────────────────────────────────────────

function extractPathParams(path: string): string[] {
    const out: string[] = [];
    const re = /:([a-zA-Z0-9_]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(path)) !== null) out.push(m[1]);
    return out;
}

function camelToTitle(name: string): string {
    return name
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, c => c.toUpperCase())
        .trim();
}

function toSlug(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        || "group";
}

function normalizePath(path: string): string {
    let p = path;
    if (!p.startsWith("/")) p = "/" + p;
    return p.replace(/\/+$/, "") || "/";
}

// ── Permission rendering ───────────────────────────────────────────────

function buildPermissionDoc(permission: GGPermission): PermissionDoc {
    const tree = toPermissionTree(permission);
    return {tree, text: renderPermissionText(tree)};
}

function toPermissionTree(p: GGPermission): PermissionTree {
    if (p === GG_NO_PERMISSIONS) return {kind: "public"};
    if (p === GG_ANY_PERMISSION) return {kind: "anyAuth"};
    if (typeof p === "string") return {kind: "scope", scope: p};
    if (p && typeof p === "object") {
        if ("allOf" in p) return {kind: "allOf", children: p.allOf.map(toPermissionTree)};
        if ("anyOf" in p) return {kind: "anyOf", children: p.anyOf.map(toPermissionTree)};
    }
    return {kind: "public"};
}

function renderPermissionText(tree: PermissionTree): string {
    switch (tree.kind) {
        case "public":  return "Public — no authentication required.";
        case "anyAuth": return "Any authenticated identity.";
        case "scope":   return `Requires \`${tree.scope}\`.`;
        case "allOf":   return `Requires ${joinChildren(tree.children, " **and** ")}.`;
        case "anyOf":   return `Requires ${joinChildren(tree.children, " **or** ")}.`;
    }
}

function joinChildren(children: PermissionTree[], sep: string): string {
    return children.map(renderInline).join(sep);
}

function renderInline(tree: PermissionTree): string {
    switch (tree.kind) {
        case "public":  return "public";
        case "anyAuth": return "any authenticated identity";
        case "scope":   return `\`${tree.scope}\``;
        case "allOf":   return `(${joinChildren(tree.children, " **and** ")})`;
        case "anyOf":   return `(${joinChildren(tree.children, " **or** ")})`;
    }
}
