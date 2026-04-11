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
    const codecHints = codec.toOpenApiOperation?.({
        pathPrefix: "",
        methodName,
        contract
    }) ?? {};

    const base: OpenAPIV3_1.OperationObject = {
        operationId: methodName,
        tags: [apiName],
        parameters: [],
        responses: buildResponses(contract),
        ...codecHints
    };

    if (!codecHints.parameters && !codec.toOpenApiOperation) {
        base.parameters = buildParametersFallback(codec, contract);
    }

    if (!codecHints.requestBody && !codec.toOpenApiOperation) {
        const reqBody = buildRequestBodyFallback(codec, contract);
        if (reqBody) base.requestBody = reqBody;
    }

    return base;
}

/**
 * openapi-types@12 defines OpenAPIV3_1.ParameterObject as a direct alias of OpenAPIV3.ParameterObject,
 * whose `schema` field resolves to V3 schema types (missing `type:"null"` as a valid type).
 * The casts to ParameterObject["schema"] below are the precise boundary of that typedef limitation —
 * the runtime objects are fully valid OpenAPI 3.1 parameters carrying V3_1 schemas.
 */
function buildParametersFallback(
    codec: GGHttpSchema<any, any>["codec"][string],
    contract: NonNullable<GGHttpSchema<any, any>["contract"]>["methods"][string]
): OpenAPIV3_1.ParameterObject[] {
    const hasBody = codec.method === "POST" || codec.method === "PUT" || codec.method === "PATCH";
    const pathParams = (codec.path.match(/:(\w+)/g) || []).map((m: string) => m.slice(1));
    const params: OpenAPIV3_1.ParameterObject[] = pathParams.map((name: string) => ({
        name,
        in: "path" as const,
        required: true as const,
        schema: {type: "string"} as OpenAPIV3_1.ParameterObject["schema"]
    }));

    if (!hasBody && contract.input) {
        const inputSchema = contract.input.toJSONSchema() as OpenAPIV3_1.NonArraySchemaObject;
        const shape = inputSchema.properties;
        const required = inputSchema.required;
        if (shape) {
            for (const [name, fieldSchema] of Object.entries(shape)) {
                if (pathParams.includes(name)) continue;
                params.push({
                    name,
                    in: "query" as const,
                    required: required?.includes(name) ?? false,
                    schema: fieldSchema as OpenAPIV3_1.ParameterObject["schema"]
                });
            }
        }
    }
    return params;
}

function buildRequestBodyFallback(
    codec: GGHttpSchema<any, any>["codec"][string],
    contract: NonNullable<GGHttpSchema<any, any>["contract"]>["methods"][string]
): OpenAPIV3_1.RequestBodyObject | undefined {
    const hasBody = codec.method === "POST" || codec.method === "PUT" || codec.method === "PATCH";
    if (!hasBody || !contract.input) return undefined;
    return {
        required: true,
        content: {
            "application/json": {
                schema: contract.input.toJSONSchema()
            }
        }
    };
}

function buildResponses(
    contract: NonNullable<GGHttpSchema<any, any>["contract"]>["methods"][string]
): OpenAPIV3_1.ResponsesObject {
    const responses: OpenAPIV3_1.ResponsesObject = {};

    // Success response
    if (contract.success) {
        const successSchema: OpenAPIV3_1.NonArraySchemaObject = {
            type: "object",
            properties: {
                success: {type: "boolean", enum: [true]},
                type: {type: "string", enum: ["OK"]},
                data: contract.success.toJSONSchema()
            },
            required: ["success", "type", "data"]
        };
        responses["200"] = {
            description: "Success",
            content: {
                "application/json": {schema: successSchema}
            }
        };
    } else {
        responses["204"] = {description: "No content"};
    }

    // Error responses — group by STATUS_CODE
    if (contract.errors?.length) {
        const byStatus = new Map<number, OpenAPIV3_1.SchemaObject[]>();

        for (const errCls of contract.errors as ANY_ERROR_CLS[]) {
            const statusCode = errCls.STATUS_CODE;
            const errType = errCls.TYPE;
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
            const content: OpenAPIV3_1.MediaTypeObject = {
                schema: schemas.length === 1
                    ? schemas[0]
                    : {oneOf: schemas}
            };
            responses[String(statusCode)] = {
                description: `Error ${statusCode}`,
                content: {"application/json": content}
            };
        }
    }

    return responses;
}

function normalizePath(path: string): string {
    return path.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function toOpenApiPathTemplate(path: string): string {
    return path.replace(/:(\w+)/g, "{$1}");
}
