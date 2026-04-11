import {HttpMethod} from "@grest-ts/common"
import {GGContractMethod, isNonJsonDef} from "@grest-ts/schema"
import {ClientHttpRouteToRpcTransformClientCodec, ClientHttpRouteToRpcTransformClientConfig, ClientHttpRouteToRpcTransformServerCodec, ClientHttpRouteToRpcTransformServerConfig, GGHttpCodec, GGHttpCodecOpenApiConfig, GGRpcRequestBuilder, GGRpcRequestParser} from "@grest-ts/http"
import {GGFileDownloadResponseBuilder} from "./GGFileDownloadResponseBuilder";
import {GGFileDownloadResponseParser} from "./GGFileDownloadResponseParser";
import type {OpenAPIV3_1} from "openapi-types";

export const GGFileDownload = {
    GET: (path: string) => new GGFileDownloadCodec("GET", path),
    POST: (path: string) => new GGFileDownloadCodec("POST", path),
}

class GGFileDownloadCodec implements GGHttpCodec {

    public readonly method: HttpMethod
    public readonly path: string

    constructor(method: HttpMethod, path: string) {
        this.method = method
        this.path = path
    }

    public createForClient(config: ClientHttpRouteToRpcTransformClientConfig): ClientHttpRouteToRpcTransformClientCodec {
        this.assertOutputIsNonJson(config.contract);
        this.assertInputIsJson(config.contract);
        return {
            createRequest: new GGRpcRequestBuilder(this.method, this.path, config).createRequest,
            parseResponse: new GGFileDownloadResponseParser(config).parseResponse
        }
    }

    public createForServer(config: ClientHttpRouteToRpcTransformServerConfig): ClientHttpRouteToRpcTransformServerCodec {
        this.assertOutputIsNonJson(config.contract);
        this.assertInputIsJson(config.contract);
        return {
            parseRequest: new GGRpcRequestParser(this.method, this.path, config).parseRequest,
            sendResponse: new GGFileDownloadResponseBuilder(config).sendResponse
        }
    }

    public toOpenApiOperation(config: GGHttpCodecOpenApiConfig): Partial<OpenAPIV3_1.OperationObject> {
        const pathParams = (this.path.match(/:(\w+)/g) || []).map(m => m.slice(1));
        const hasBody = this.method === "POST" || this.method === "PUT" || this.method === "PATCH";

        const inputSchema = config.contract.input
            ? config.contract.input.toJSONSchema() as OpenAPIV3_1.NonArraySchemaObject
            : undefined;
        const shape = inputSchema?.properties;
        const required = inputSchema?.required;

        const parameters: OpenAPIV3_1.ParameterObject[] = pathParams.map(name => {
            const fieldSchema = shape?.[name] as OpenAPIV3_1.SchemaObject | undefined;
            const param: OpenAPIV3_1.ParameterObject = {
                name,
                in: 'path' as const,
                required: true as const,
                schema: (fieldSchema ?? {type: 'string'}) as OpenAPIV3_1.ParameterObject["schema"]
            };
            if (fieldSchema?.description) param.description = fieldSchema.description;
            return param;
        });

        const operation: Partial<OpenAPIV3_1.OperationObject> = {
            operationId: config.methodName,
            parameters,
            // Success: raw binary file response — not a JSON envelope
            responses: {
                "200": {
                    description: "File download",
                    headers: {
                        "Content-Disposition": {
                            description: "attachment; filename=<name>",
                            schema: {type: "string"}
                        }
                    },
                    content: {
                        "*/*": {
                            schema: {type: "string", format: "binary"} as OpenAPIV3_1.ParameterObject["schema"]
                        }
                    }
                } as OpenAPIV3_1.ResponseObject
            }
        };

        if (!hasBody && shape) {
            for (const [name, fieldSchema] of Object.entries(shape)) {
                if (pathParams.includes(name)) continue;
                const param: OpenAPIV3_1.ParameterObject = {
                    name,
                    in: 'query' as const,
                    required: required?.includes(name) ?? false,
                    schema: fieldSchema as OpenAPIV3_1.ParameterObject["schema"]
                };
                if ((fieldSchema as OpenAPIV3_1.SchemaObject).description) {
                    param.description = (fieldSchema as OpenAPIV3_1.SchemaObject).description;
                }
                parameters.push(param);
            }
        }

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

    private assertOutputIsNonJson(contract: GGContractMethod): void {
        const def = contract.success?.toCompilerDef();
        if (!def || !isNonJsonDef(def)) {
            throw new Error(`GGFileDownload.${this.method}("${this.path}") requires output schema to be a non-JSON leaf type (e.g. IsFile). Use GGRpc.GET/POST for routes without file output.`);
        }
    }

    private assertInputIsJson(contract: GGContractMethod): void {
        if (contract.input?.toCompilerDef().hasNonJsonData) {
            throw new Error(`GGFileDownload.${this.method}("${this.path}") does not support non-JSON input data (e.g. files). File download routes accept JSON input only.`);
        }
    }
}
