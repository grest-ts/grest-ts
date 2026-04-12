import type {GGHttpSchema} from "@grest-ts/http";
import type {ANY_ERROR_CLS} from "@grest-ts/schema";
import type {OpenAPIV3_1} from "openapi-types";
import {SchemaRegistry} from "./SchemaRegistry";

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

    for (const httpSchema of schemas) {
        if (!httpSchema.contract) continue;
        const pathPrefix = "/" + httpSchema.pathPrefix;

        for (const methodName of Object.keys(httpSchema.codec)) {
            const codec = httpSchema.codec[methodName];
            const contract = httpSchema.contract.methods[methodName];
            if (!codec || !contract) continue;

            const rawPath = normalizePath(pathPrefix + "/" + codec.path);
            const openApiPath = toOpenApiPathTemplate(rawPath);
            const httpMethod = codec.method.toLowerCase() as OpenAPIV3_1.HttpMethods;

            const operation = buildOperation(httpSchema.name, methodName, codec, contract, registry);

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

    const components = registry.getComponents();
    if (components) {
        doc.components = {schemas: components};
    }

    if (options.servers?.length) {
        doc.servers = options.servers;
    }

    return doc;
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
        schemaResolver: (schema) => registry.schemaOrRef(schema)
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

    return {
        parameters: [],
        ...codecResult,
        operationId: `${apiName}_${methodName}`,
        summary: camelToSummary(methodName),
        tags: [apiName],
        responses: {...codecResult.responses, ...errorResponses}
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
