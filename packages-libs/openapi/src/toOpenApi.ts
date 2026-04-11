import type {GGHttpSchema} from "@grest-ts/http";
import type {ANY_ERROR_CLS} from "@grest-ts/schema";
import type {OpenAPIV3_1} from "openapi-types";

export interface ToOpenApiOptions {
    title?: string;
    version?: string;
    description?: string;
    servers?: OpenAPIV3_1.ServerObject[];
}

/**
 * Convert a list of GGHttpSchema instances to an OpenAPI 3.1 document.
 * Pure function — no side effects, safe to call in CI/scripts.
 */
export function toOpenApi(
    schemas: GGHttpSchema<any, any>[],
    options: ToOpenApiOptions = {}
): OpenAPIV3_1.Document {
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

            const operation = buildOperation(httpSchema.name, methodName, codec, contract);

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

    if (options.servers?.length) {
        doc.servers = options.servers;
    }

    return doc;
}

function buildOperation(
    apiName: string,
    methodName: string,
    codec: GGHttpSchema<any, any>["codec"][string],
    contract: NonNullable<GGHttpSchema<any, any>["contract"]>["methods"][string]
): OpenAPIV3_1.OperationObject {
    if (!codec.toOpenApiOperation) {
        throw new Error(
            `Codec for ${apiName}.${methodName} (${codec.method} ${codec.path}) does not implement toOpenApiOperation(). ` +
            `All codecs used in an OpenAPI schema must implement this method. ` +
            `Built-in GGRpc.*, GGFileUpload, and GGFileDownload codecs support it automatically. ` +
            `Custom codec authors must implement toOpenApiOperation() to be usable with @grest-ts/openapi.`
        );
    }

    const codecResult = codec.toOpenApiOperation({pathPrefix: "", methodName, contract});

    if (!codecResult.responses) {
        throw new Error(
            `Codec for ${apiName}.${methodName} (${codec.method} ${codec.path}) returned no responses from toOpenApiOperation(). ` +
            `Every codec must declare its own success response shape. ` +
            `Use buildRpcSuccessResponses(contract) from @grest-ts/http if your codec uses the standard JSON envelope.`
        );
    }

    // Success response: always from the codec (it owns the wire format).
    // Error responses: always from the contract (codec has no say in error shapes).
    const errorResponses = buildErrorResponses(contract);

    return {
        operationId: methodName,
        summary: camelToSummary(methodName),
        tags: [apiName],
        parameters: [],
        ...codecResult,
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
    contract: NonNullable<GGHttpSchema<any, any>["contract"]>["methods"][string]
): OpenAPIV3_1.ResponsesObject {
    const responses: OpenAPIV3_1.ResponsesObject = {};
    if (!contract.errors?.length) return responses;

    const byStatus = new Map<number, OpenAPIV3_1.SchemaObject[]>();
    const byStatusTypes = new Map<number, string[]>();

    for (const errCls of contract.errors as ANY_ERROR_CLS[]) {
        const statusCode = errCls.STATUS_CODE;
        const errType = errCls.TYPE;
        if (!byStatusTypes.has(statusCode)) byStatusTypes.set(statusCode, []);
        byStatusTypes.get(statusCode)!.push(errType);

        const dataSchema: OpenAPIV3_1.SchemaObject | undefined =
            errCls.schema != null ? errCls.schema.toJSONSchema() : undefined;

        const props: NonNullable<OpenAPIV3_1.BaseSchemaObject["properties"]> = {
            success: {type: "boolean", enum: [false]},
            type: {type: "string", enum: [errType]},
        };
        if (dataSchema !== undefined) props.data = dataSchema;

        const errorBodySchema: OpenAPIV3_1.NonArraySchemaObject = {
            type: "object",
            properties: props,
            required: ["success", "type", ...(dataSchema !== undefined ? ["data"] : [])]
        };

        if (!byStatus.has(statusCode)) byStatus.set(statusCode, []);
        byStatus.get(statusCode)!.push(errorBodySchema);
    }

    for (const [statusCode, schemas] of byStatus) {
        const typeNames = byStatusTypes.get(statusCode)!;
        responses[String(statusCode)] = {
            description: typeNames.join(" | "),
            content: {
                "application/json": {
                    schema: schemas.length === 1 ? schemas[0] : {oneOf: schemas}
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
