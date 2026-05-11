import type {GGHttpSchema, GGHttpTransportMiddleware} from "@grest-ts/http";
import type {ANY_ERROR_CLS, GGPermission} from "@grest-ts/schema";
import {GG_ANY_PERMISSION, GG_NO_PERMISSIONS} from "@grest-ts/schema";
import type {OpenAPIV3_1} from "openapi-types";
import {SchemaRegistry} from "./SchemaRegistry";

const DEFAULT_BEARER_SCHEME = "BearerAuth";

export interface ToOpenApiOptions {
    title?: string;
    version?: string;
    description?: string;
    servers?: OpenAPIV3_1.ServerObject[];
}

/**
 * Convert a list of GGHttpSchema instances to an OpenAPI 3.1 document.
 * Pure function — no side effects, safe to call in CI/scripts.
 *
 * Named schemas (those with a .docs({title}) set) are extracted into
 * components/schemas and referenced via $ref, eliminating duplication when
 * the same schema object is used across multiple operations.
 */
export function toOpenApi(
    schemas: GGHttpSchema<any, any>[],
    options: ToOpenApiOptions = {}
): OpenAPIV3_1.Document {
    const registry = new SchemaRegistry();
    const paths: OpenAPIV3_1.PathsObject = {};

    const securitySchemes = new Map<string, OpenAPIV3_1.SecuritySchemeObject>();

    for (const httpSchema of schemas) {
        if (!httpSchema.contract) continue;
        const pathPrefix = "/" + httpSchema.pathPrefix;

        // Split middlewares into security schemes and plain header params
        const {headerParams, operationSecurity} = buildMiddlewareOpenApi(
            httpSchema.apiMiddlewares, registry, securitySchemes
        );

        for (const methodName of Object.keys(httpSchema.codec)) {
            const codec = httpSchema.codec[methodName];
            const contract = httpSchema.contract.methods[methodName];
            if (!codec || !contract) continue;

            const rawPath = normalizePath(pathPrefix + "/" + codec.path);
            const openApiPath = toOpenApiPathTemplate(rawPath);
            const httpMethod = codec.method.toLowerCase() as OpenAPIV3_1.HttpMethods;

            const operation = buildOperation(httpSchema.name, methodName, codec, contract, registry);

            if (headerParams.length > 0) {
                const existing = (operation.parameters ?? []) as OpenAPIV3_1.ParameterObject[];
                operation.parameters = [...headerParams, ...existing];
            }
            if (operationSecurity.length > 0) {
                operation.security = operationSecurity;
            }

            // Contract permission → OpenAPI security. This overrides middleware-derived
            // security so the doc reflects the gate's actual required-scope semantics.
            if (contract.permission !== undefined) {
                const permSecurity = buildSecurityFromPermission(contract.permission, securitySchemes);
                if (permSecurity !== null) {
                    operation.security = permSecurity;
                }
            }

            if (!paths[openApiPath]) paths[openApiPath] = {};
            (paths[openApiPath] as Record<string, unknown>)[httpMethod] = operation;
        }
    }

    const doc: OpenAPIV3_1.Document = {
        openapi: "3.1.0",
        info: {
            title: options.title ?? "API",
            version: options.version ?? "1.0.0",
            ...(options.description ? {description: options.description} : {})
        },
        paths
    };

    const schemaComponents = registry.getComponents();
    const securityComponents = securitySchemes.size > 0
        ? Object.fromEntries(securitySchemes)
        : undefined;

    if (schemaComponents || securityComponents) {
        doc.components = {
            ...(schemaComponents ? {schemas: schemaComponents} : {}),
            ...(securityComponents ? {securitySchemes: securityComponents} : {}),
        };
    }

    if (options.servers?.length) {
        doc.servers = options.servers;
    }

    return doc;
}

/**
 * Process middleware headers, splitting them into:
 * - Plain header parameters (format unset or unknown)
 * - Security scheme references (format: "bearer" → BearerAuth, format: "api-key" → ApiKeyAuth)
 *
 * Security headers are registered in `securitySchemes` and returned as `security` requirements
 * on the operation so Swagger UI shows the padlock "Authorize" button.
 */
function buildMiddlewareOpenApi(
    middlewares: readonly GGHttpTransportMiddleware[],
    registry: SchemaRegistry,
    securitySchemes: Map<string, OpenAPIV3_1.SecuritySchemeObject>
): { headerParams: OpenAPIV3_1.ParameterObject[]; operationSecurity: OpenAPIV3_1.SecurityRequirementObject[] } {
    const headerParams: OpenAPIV3_1.ParameterObject[] = [];
    const operationSecurity: OpenAPIV3_1.SecurityRequirementObject[] = [];

    for (const mw of middlewares) {
        for (const [name, schema] of Object.entries(mw.headers)) {
            const desc = schema.toSchemaDescription();
            const format = desc.docs?.format;

            if (format === 'bearer') {
                // HTTP Bearer auth → securitySchemes + security requirement on operation
                const schemeName = desc.docs?.title
                    ? toSecuritySchemeName(desc.docs.title)
                    : 'BearerAuth';
                if (!securitySchemes.has(schemeName)) {
                    securitySchemes.set(schemeName, {
                        type: 'http',
                        scheme: 'bearer',
                        ...(desc.docs?.description ? {description: desc.docs.description} : {}),
                    });
                }
                operationSecurity.push({[schemeName]: []});

            } else if (format === 'api-key') {
                // API key in header → securitySchemes + security requirement on operation
                const schemeName = desc.docs?.title
                    ? toSecuritySchemeName(desc.docs.title)
                    : 'ApiKeyAuth';
                if (!securitySchemes.has(schemeName)) {
                    securitySchemes.set(schemeName, {
                        type: 'apiKey',
                        in: 'header',
                        name,
                        ...(desc.docs?.description ? {description: desc.docs.description} : {}),
                    });
                }
                operationSecurity.push({[schemeName]: []});

            } else {
                // Plain header parameter
                const resolved = registry.descOrRef(desc);
                const {description, ...schemaWithoutDescription} = resolved as any;
                const param: OpenAPIV3_1.ParameterObject = {
                    name,
                    in: 'header' as const,
                    required: !desc.optional,
                    schema: schemaWithoutDescription as OpenAPIV3_1.ParameterObject["schema"]
                };
                if (description) param.description = description;
                headerParams.push(param);
            }
        }
    }
    return {headerParams, operationSecurity};
}

/** Convert a human-readable title to a valid security scheme name. e.g. "Bearer token" → "BearerToken" */
/**
 * Map a GGPermission tree to OpenAPI `security` requirements.
 *
 * Returns `null` when the permission is undefined (caller should not modify
 * operation.security in that case).
 *
 * Mapping:
 *  - GG_NO_PERMISSIONS → `[]` (explicit "no security" per OpenAPI spec)
 *  - GG_ANY_PERMISSION → `[{BearerAuth: []}]`
 *  - bare string       → `[{BearerAuth: [scope]}]`
 *  - allOf(a, b)       → `[{BearerAuth: [a, b]}]` (single requirement, multiple scopes = AND)
 *  - anyOf(a, b)       → `[{BearerAuth: [a]}, {BearerAuth: [b]}]` (multiple requirements = OR)
 *  - Nested anyOf(allOf, ...) → flattened to disjunctive normal form.
 *
 * Registers the BearerAuth scheme if any non-empty mapping is emitted.
 */
function buildSecurityFromPermission(
    permission: GGPermission,
    securitySchemes: Map<string, OpenAPIV3_1.SecuritySchemeObject>
): OpenAPIV3_1.SecurityRequirementObject[] | null {
    if (permission === GG_NO_PERMISSIONS) return [];
    if (permission === GG_ANY_PERMISSION) {
        registerBearerAuth(securitySchemes);
        return [{[DEFAULT_BEARER_SCHEME]: []}];
    }
    // Flatten to DNF: list of scope-sets, each scope-set is an AND group.
    const dnf = toDNF(permission);
    if (dnf.length === 0) return [];
    registerBearerAuth(securitySchemes);
    return dnf.map(scopes => ({[DEFAULT_BEARER_SCHEME]: scopes}));
}

/**
 * Convert a GGPermission tree to disjunctive normal form: a list of
 * scope-sets where each scope-set means "AND" and the outer list means "OR".
 *
 * Example: anyOf("a", allOf("b", "c"))  →  [["a"], ["b", "c"]]
 */
function toDNF(p: GGPermission): string[][] {
    if (typeof p === "string") return [[p]];
    if (typeof p === "symbol") {
        // GG_NO_PERMISSIONS / GG_ANY_PERMISSION shouldn't reach this path —
        // they're handled in buildSecurityFromPermission.
        return [];
    }
    if ("allOf" in p) {
        // Cartesian product across children's DNFs.
        let result: string[][] = [[]];
        for (const child of p.allOf) {
            const childDnf = toDNF(child);
            if (childDnf.length === 0) continue;
            const next: string[][] = [];
            for (const acc of result) {
                for (const childAlt of childDnf) {
                    next.push([...acc, ...childAlt]);
                }
            }
            result = next;
        }
        return result.map(dedupScopes);
    }
    if ("anyOf" in p) {
        const result: string[][] = [];
        for (const child of p.anyOf) {
            for (const childAlt of toDNF(child)) {
                result.push(childAlt);
            }
        }
        return result.map(dedupScopes);
    }
    return [];
}

function dedupScopes(scopes: string[]): string[] {
    return Array.from(new Set(scopes));
}

function registerBearerAuth(securitySchemes: Map<string, OpenAPIV3_1.SecuritySchemeObject>): void {
    if (!securitySchemes.has(DEFAULT_BEARER_SCHEME)) {
        securitySchemes.set(DEFAULT_BEARER_SCHEME, {
            type: "http",
            scheme: "bearer",
            description: "Bearer token. Scopes listed per operation are required to invoke that operation.",
        });
    }
}

function toSecuritySchemeName(title: string): string {
    return title
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join('');
}

function buildOperation(
    apiName: string,
    methodName: string,
    codec: GGHttpSchema<any, any>["codec"][string],
    contract: NonNullable<GGHttpSchema<any, any>["contract"]>["methods"][string],
    registry: SchemaRegistry
): OpenAPIV3_1.OperationObject {
    if (!codec.toOpenApiOperation) {
        throw new Error(
            `Codec for ${apiName}.${methodName} (${codec.method} ${codec.path}) does not implement toOpenApiOperation(). ` +
            `All codecs used in an OpenAPI schema must implement this method. ` +
            `Built-in GGRpc.*, GGFileUpload, and GGFileDownload codecs support it automatically. ` +
            `Custom codec authors must implement toOpenApiOperation() to be usable with @grest-ts/openapi.`
        );
    }

    const codecResult = codec.toOpenApiOperation({
        pathPrefix: "",
        methodName,
        contract,
        schemaResolver: (desc) => registry.descOrRef(desc)
    });

    if (!codecResult.responses) {
        throw new Error(
            `Codec for ${apiName}.${methodName} (${codec.method} ${codec.path}) returned no responses from toOpenApiOperation(). ` +
            `Every codec must declare its own success response shape. ` +
            `Use buildRpcSuccessResponses(contract, config.schemaResolver) from @grest-ts/http if your codec uses the standard JSON envelope.`
        );
    }

    // Success response: always from the codec (it owns the wire format, including $ref).
    // Error responses: always from the contract (codec has no say in error shapes).
    const errorResponses = buildErrorResponses(contract, registry);

    // Response headers from codec.responseHeaders — merged into every response entry
    const codecResponseHeaders = buildResponseHeaders(codec.responseHeaders, registry);

    const allResponses = {...codecResult.responses, ...errorResponses};
    const responsesWithHeaders = codecResponseHeaders
        ? enrichResponsesWithHeaders(allResponses, codecResponseHeaders)
        : allResponses;

    return {
        parameters: [],
        ...codecResult,
        operationId: `${apiName}_${methodName}`,
        summary: camelToSummary(methodName),
        tags: [apiName],
        responses: responsesWithHeaders,
        ...(codec.deprecated ? {deprecated: true} : {}),
    };
}

/**
 * Convert camelCase method name to a human-readable summary string.
 * e.g. "getWatchedValue" → "Get Watched Value"
 */
function camelToSummary(name: string): string {
    return name
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, s => s.toUpperCase())
        .trim();
}

/**
 * Build a headers object from a codec's responseHeaders map.
 * Returns undefined if the map is empty — no headers to add.
 */
function buildResponseHeaders(
    responseHeaders: Record<string, import("@grest-ts/schema").GGSchema<string | undefined>>,
    registry: SchemaRegistry
): Record<string, OpenAPIV3_1.HeaderObject> | undefined {
    const entries = Object.entries(responseHeaders);
    if (entries.length === 0) return undefined;
    const headers: Record<string, OpenAPIV3_1.HeaderObject> = {};
    for (const [name, schema] of entries) {
        const desc = schema.toSchemaDescription();
        const resolved = registry.descOrRef(desc);
        const {description, ...schemaWithoutDescription} = resolved as any;
        const header: OpenAPIV3_1.HeaderObject = {
            schema: schemaWithoutDescription as OpenAPIV3_1.HeaderObject["schema"]
        };
        if (description) header.description = description;
        headers[name] = header;
    }
    return headers;
}

/**
 * Merge response headers into every response entry in a responses object.
 * Only adds to responses that contain content (not 204 No content etc.).
 */
function enrichResponsesWithHeaders(
    responses: OpenAPIV3_1.ResponsesObject,
    headers: Record<string, OpenAPIV3_1.HeaderObject>
): OpenAPIV3_1.ResponsesObject {
    const result: OpenAPIV3_1.ResponsesObject = {};
    for (const [code, resp] of Object.entries(responses)) {
        const r = resp as OpenAPIV3_1.ResponseObject;
        result[code] = {
            ...r,
            headers: {...(r.headers ?? {}), ...headers}
        };
    }
    return result;
}

/**
 * Error responses derived from the contract's error classes.
 * These are always merged on top of whatever responses the codec provides.
 */
function buildErrorResponses(
    contract: NonNullable<GGHttpSchema<any, any>["contract"]>["methods"][string],
    registry: SchemaRegistry
): OpenAPIV3_1.ResponsesObject {
    const responses: OpenAPIV3_1.ResponsesObject = {};
    if (!contract.errors?.length) return responses;

    // Group by STATUS_CODE. Each error class becomes a $ref to its component.
    const byStatus = new Map<number, OpenAPIV3_1.ReferenceObject[]>();
    const byStatusTypes = new Map<number, string[]>();

    for (const errCls of contract.errors as ANY_ERROR_CLS[]) {
        const statusCode = errCls.STATUS_CODE;
        if (!byStatusTypes.has(statusCode)) byStatusTypes.set(statusCode, []);
        byStatusTypes.get(statusCode)!.push(errCls.TYPE);

        if (!byStatus.has(statusCode)) byStatus.set(statusCode, []);
        byStatus.get(statusCode)!.push(registry.errorBodyRef(errCls));
    }

    for (const [statusCode, refs] of byStatus) {
        const typeNames = byStatusTypes.get(statusCode)!;
        responses[String(statusCode)] = {
            description: typeNames.join(" | "),
            content: {
                "application/json": {
                    schema: refs.length === 1 ? refs[0] : {oneOf: refs}
                }
            }
        };
    }

    return responses;
}

function normalizePath(path: string): string {
    return path.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function toOpenApiPathTemplate(path: string): string {
    return path.replace(/:(\w+)/g, "{$1}");
}
