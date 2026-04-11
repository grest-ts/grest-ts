import {HttpMethod} from "@grest-ts/common"
import {ClientHttpRouteToRpcTransformClientCodec, ClientHttpRouteToRpcTransformClientConfig, ClientHttpRouteToRpcTransformServerCodec, ClientHttpRouteToRpcTransformServerConfig, GGHttpCodec, GGHttpCodecOpenApiConfig} from "../schema/GGHttpSchema"
import {GGRpcRequestBuilder} from "./RpcRequest/GGRpcRequestBuilder";
import {GGRpcResponseParser} from "./RpcResponse/GGRpcResponseParser";
import {GGSchema} from "@grest-ts/schema";
import type {OpenAPIV3_1} from "openapi-types";

export type GGRpcServerCodecFactory = (method: HttpMethod, path: string, config: ClientHttpRouteToRpcTransformServerConfig) => ClientHttpRouteToRpcTransformServerCodec;

let _serverCodecFactory: GGRpcServerCodecFactory | undefined;

export function _registerRpcServerCodecFactory(factory: GGRpcServerCodecFactory): void {
    _serverCodecFactory = factory;
}

export const GGRpc = {
    GET: (path: string) => new GGHttpRpcCodec("GET", path),
    DELETE: (path: string) => new GGHttpRpcCodec("DELETE", path),
    POST: (path: string) => new GGHttpRpcCodec("POST", path),
    PUT: (path: string) => new GGHttpRpcCodec("PUT", path),
}

/**
 * Build OpenAPI parameter objects for a route.
 *
 * openapi-types@12 defines OpenAPIV3_1.ParameterObject as a direct alias of OpenAPIV3.ParameterObject,
 * whose `schema` field uses V3 schema types that don't include `type:"null"` as a valid NonArraySchemaObjectType.
 * The single cast below is the precise boundary of that typedef limitation — the runtime objects are valid
 * OpenAPI 3.1 parameters with V3_1 schemas.
 */
function buildOpenApiParameters(
    pathParams: string[],
    hasBody: boolean,
    inputSchema: GGSchema<unknown> | undefined
): OpenAPIV3_1.ParameterObject[] {
    const params: OpenAPIV3_1.ParameterObject[] = pathParams.map(name => ({
        name,
        in: 'path' as const,
        required: true as const,
        schema: {type: 'string'} as OpenAPIV3_1.ParameterObject["schema"]
    }));

    if (!hasBody && inputSchema) {
        const objSchema = inputSchema.toJSONSchema() as OpenAPIV3_1.NonArraySchemaObject;
        const shape = objSchema.properties;
        const required = objSchema.required;
        if (shape) {
            for (const [name, fieldSchema] of Object.entries(shape)) {
                if (pathParams.includes(name)) continue;
                params.push({
                    name,
                    in: 'query' as const,
                    required: required?.includes(name) ?? false,
                    schema: fieldSchema as OpenAPIV3_1.ParameterObject["schema"]
                });
            }
        }
    }
    return params;
}

class GGHttpRpcCodec implements GGHttpCodec {

    public readonly method: HttpMethod
    public readonly path: string

    constructor(method: HttpMethod, path: string) {
        this.method = method
        this.path = path
    }

    public createForClient(config: ClientHttpRouteToRpcTransformClientConfig): ClientHttpRouteToRpcTransformClientCodec {
        return {
            createRequest: new GGRpcRequestBuilder(this.method, this.path, config).createRequest,
            parseResponse: new GGRpcResponseParser(config).parseResponse
        }
    }

    public createForServer(config: ClientHttpRouteToRpcTransformServerConfig): ClientHttpRouteToRpcTransformServerCodec {
        if (!_serverCodecFactory) throw new Error("Server RPC codec not available. Ensure @grest-ts/http server entry is imported.");
        return _serverCodecFactory(this.method, this.path, config);
    }

    public toOpenApiOperation(config: GGHttpCodecOpenApiConfig): Partial<OpenAPIV3_1.OperationObject> {
        const pathParams = (this.path.match(/:(\w+)/g) || []).map(m => m.slice(1));
        const hasBody = this.method === "POST" || this.method === "PUT" || this.method === "PATCH";
        const operationId = config.methodName;

        const parameters = buildOpenApiParameters(pathParams, hasBody, config.contract.input ?? undefined);
        const operation: Partial<OpenAPIV3_1.OperationObject> = {operationId, parameters};

        if (hasBody && config.contract.input) {
            operation.requestBody = {
                required: true,
                content: {
                    'application/json': {
                        schema: config.contract.input.toJSONSchema()
                    }
                }
            };
        }

        return operation;
    }
}
