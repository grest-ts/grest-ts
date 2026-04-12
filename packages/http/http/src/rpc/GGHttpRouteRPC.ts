import {HttpMethod} from "@grest-ts/common"
import {ClientHttpRouteToRpcTransformClientCodec, ClientHttpRouteToRpcTransformClientConfig, ClientHttpRouteToRpcTransformServerCodec, ClientHttpRouteToRpcTransformServerConfig, GGHttpCodec, GGHttpCodecOpenApiConfig} from "../schema/GGHttpSchema"
import {GGRpcRequestBuilder} from "./RpcRequest/GGRpcRequestBuilder";
import {GGRpcResponseParser} from "./RpcResponse/GGRpcResponseParser";
import type {OpenAPIV3_1} from "openapi-types";
import {buildRpcSuccessResponses} from "./openApiSuccessResponse";
import {buildOpenApiParameters} from "./openApiHelpers";

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

class GGHttpRpcCodec implements GGHttpCodec {

    public readonly method: HttpMethod
    public readonly path: string
    public readonly responseHeaders: readonly string[] = []

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
        const hasBody = this.method === "POST" || this.method === "PUT" || this.method === "PATCH";
        const operationId = config.methodName;

        const parameters = buildOpenApiParameters(this.path, hasBody, config.contract.input ?? undefined, config.schemaResolver);
        const operation: Partial<OpenAPIV3_1.OperationObject> = {
            operationId,
            parameters,
            responses: buildRpcSuccessResponses(config.contract, config.schemaResolver)
        };

        if (hasBody && config.contract.input) {
            operation.requestBody = {
                required: true,
                content: {'application/json': {schema: config.schemaResolver(config.contract.input.toSchemaDescription())}}
            };
        }

        return operation;
    }
}
