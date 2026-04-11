import type {GGHttpSchema} from "@grest-ts/http";
import type {ANY_ERROR_CLS, GGSchema} from "@grest-ts/schema";
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

    const codecResult = codec.toOpenApiOperation({pathPrefix: "", methodName, contract});

    if (!codecResult.responses) {
        throw new Error(
            `Codec for ${apiName}.${methodName} (${codec.method} ${codec.path}) returned no responses from toOpenApiOperation(). ` +
            `Every codec must declare its own success response shape. ` +
            `Use buildRpcSuccessResponses(contract) from @grest-ts/http if your codec uses the standard JSON envelope.`
        );
    }

    // Re-build the codec result replacing inline schemas with $ref where applicable
    const enrichedCodecResult = enrichWithRefs(codecResult, contract, registry);

    // Success response: always from the codec (it owns the wire format).
    // Error responses: always from the contract (codec has no say in error shapes).
    const errorResponses = buildErrorResponses(contract, registry);

    return {
        parameters: [],
        ...enrichedCodecResult,
        operationId: `${apiName}_${methodName}`,
        summary: camelToSummary(methodName),
        tags: [apiName],
        responses: {...enrichedCodecResult.responses, ...errorResponses}
    };
}

/**
 * Replace inline schema objects in a codec result with $ref where the schema
 * has a title (and is thus extractable to components/schemas).
 * Only touches the fields that contain GGSchema-derived content.
 */
function enrichWithRefs(
    codecResult: Partial<OpenAPIV3_1.OperationObject>,
    contract: NonNullable<GGHttpSchema<any, any>["contract"]>["methods"][string],
    registry: SchemaRegistry
): Partial<OpenAPIV3_1.OperationObject> {
    const result: Partial<OpenAPIV3_1.OperationObject> = {...codecResult};

    // Enrich requestBody — codec may have put the input schema inline
    if (result.requestBody && contract.input) {
        const rb = result.requestBody as OpenAPIV3_1.RequestBodyObject;
        if (rb.content?.['application/json']?.schema) {
            result.requestBody = {
                ...rb,
                content: {
                    ...rb.content,
                    'application/json': {
                        ...rb.content['application/json'],
                        schema: registry.schemaOrRef(contract.input)
                    }
                }
            };
        }
    }

    // Enrich success response — codec put the success schema inline
    if (result.responses?.['200'] && contract.success) {
        const resp200 = result.responses['200'] as OpenAPIV3_1.ResponseObject;
        if (resp200.content?.['application/json']?.schema) {
            const envelope = resp200.content['application/json'].schema as any;
            // The envelope is {success, type, data: <success schema>}
            // Replace just the data property with a $ref if applicable
            if (envelope.properties?.data) {
                const enrichedEnvelope: OpenAPIV3_1.NonArraySchemaObject = {
                    ...envelope,
                    properties: {
                        ...envelope.properties,
                        data: registry.schemaOrRef(contract.success)
                    }
                };
                result.responses = {
                    ...result.responses,
                    '200': {
                        ...resp200,
                        content: {
                            ...resp200.content,
                            'application/json': {schema: enrichedEnvelope}
                        }
                    }
                };
            }
        }
    }

    return result;
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

    const byStatus = new Map<number, OpenAPIV3_1.SchemaObject[]>();
    const byStatusTypes = new Map<number, string[]>();

    for (const errCls of contract.errors as ANY_ERROR_CLS[]) {
        const statusCode = errCls.STATUS_CODE;
        const errType = errCls.TYPE;
        if (!byStatusTypes.has(statusCode)) byStatusTypes.set(statusCode, []);
        byStatusTypes.get(statusCode)!.push(errType);

        const dataSchemaOrRef: OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject | undefined =
            errCls.schema != null ? registry.schemaOrRef(errCls.schema as GGSchema<any>) : undefined;

        const props: NonNullable<OpenAPIV3_1.BaseSchemaObject["properties"]> = {
            success: {type: "boolean", enum: [false]},
            type: {type: "string", enum: [errType]},
        };
        if (dataSchemaOrRef !== undefined) props.data = dataSchemaOrRef;

        const errorBodySchema: OpenAPIV3_1.NonArraySchemaObject = {
            type: "object",
            properties: props,
            required: ["success", "type", ...(dataSchemaOrRef !== undefined ? ["data"] : [])]
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
