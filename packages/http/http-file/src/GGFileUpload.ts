import {HttpMethod} from "@grest-ts/common"
import {ClientHttpRouteToRpcTransformClientCodec, ClientHttpRouteToRpcTransformClientConfig, ClientHttpRouteToRpcTransformServerCodec, ClientHttpRouteToRpcTransformServerConfig, GGHttpCodec, GGHttpCodecOpenApiConfig, GGRpcResponseParser, GGRpcResponseBuilder} from "@grest-ts/http"
import {GGFileUploadRequestBuilder} from "./GGFileUploadRequestBuilder";
import {GGFileUploadRequestParser} from "./GGFileUploadRequestParser";
import type {OpenAPIV3_1} from "openapi-types";

export const GGFileUpload = {
    POST: (path: string) => new GGFileUploadCodec("POST", path),
}

class GGFileUploadCodec implements GGHttpCodec {

    public readonly method: HttpMethod
    public readonly path: string

    constructor(method: HttpMethod, path: string) {
        this.method = method
        this.path = path
    }

    public createForClient(config: ClientHttpRouteToRpcTransformClientConfig): ClientHttpRouteToRpcTransformClientCodec {
        this.assertHasNonJsonData(config.contract);
        return {
            createRequest: new GGFileUploadRequestBuilder(this.method, this.path, config).createRequest,
            parseResponse: new GGRpcResponseParser(config).parseResponse
        }
    }

    public createForServer(config: ClientHttpRouteToRpcTransformServerConfig): ClientHttpRouteToRpcTransformServerCodec {
        this.assertHasNonJsonData(config.contract);
        return {
            parseRequest: new GGFileUploadRequestParser(this.method, this.path, config).parseRequest,
            sendResponse: new GGRpcResponseBuilder(config).sendResponse
        }
    }

    public toOpenApiOperation(config: GGHttpCodecOpenApiConfig): Partial<OpenAPIV3_1.OperationObject> {
        const pathParams = (this.path.match(/:(\w+)/g) || []).map(m => m.slice(1));
        const parameters: OpenAPIV3_1.ParameterObject[] = pathParams.map(name => ({
            name,
            in: 'path' as const,
            required: true as const,
            schema: {type: 'string'} as OpenAPIV3_1.ParameterObject["schema"]
        }));

        const inputSchema = config.contract.input?.toJSONSchema() as OpenAPIV3_1.NonArraySchemaObject | undefined;
        const shape = inputSchema?.properties;
        const requiredFields = inputSchema?.required;

        const schemaProperties: Record<string, OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject> = {};
        const required: string[] = [];

        if (shape) {
            for (const [name, fieldSchema] of Object.entries(shape)) {
                if (pathParams.includes(name)) continue;
                schemaProperties[name] = fieldSchema;
                if (requiredFields?.includes(name)) {
                    required.push(name);
                }
            }
        }

        return {
            operationId: config.methodName,
            parameters,
            requestBody: {
                required: true,
                content: {
                    'multipart/form-data': {
                        schema: {
                            type: 'object',
                            properties: schemaProperties,
                            ...(required.length > 0 ? {required} : {})
                        } as OpenAPIV3_1.NonArraySchemaObject
                    }
                }
            }
        };
    }

    private assertHasNonJsonData(contract: { input?: { toCompilerDef(): { hasNonJsonData?: boolean } } }): void {
        if (!contract.input?.toCompilerDef().hasNonJsonData) {
            throw new Error(`GGFileUpload.POST("${this.path}") is used on a route with no non-JSON data (e.g. files). Use GGRpc.POST instead.`);
        }
    }
}
