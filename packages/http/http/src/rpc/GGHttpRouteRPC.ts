import {HttpMethod} from "@grest-ts/common"
import {ClientHttpRouteToRpcTransformClientCodec, ClientHttpRouteToRpcTransformClientConfig, ClientHttpRouteToRpcTransformServerCodec, ClientHttpRouteToRpcTransformServerConfig, GGHttpCodec, GGHttpCodecOpenApiConfig} from "../schema/GGHttpSchema"
import {GGRpcRequestBuilder} from "./RpcRequest/GGRpcRequestBuilder";
import {GGRpcResponseParser} from "./RpcResponse/GGRpcResponseParser";
import type {GGCookie} from "../schema/GGCookie";
import type {OpenAPIV3_1} from "openapi-types";
import {GGSchema} from "@grest-ts/schema";
import {buildRpcSuccessResponses} from "./openApiSuccessResponse";
import {buildOpenApiParameters} from "./openApiHelpers";

export type GGRpcServerCodecFactory = (method: HttpMethod, path: string, config: ClientHttpRouteToRpcTransformServerConfig) => ClientHttpRouteToRpcTransformServerCodec;

let _serverCodecFactory: GGRpcServerCodecFactory | undefined;

export function _registerRpcServerCodecFactory(factory: GGRpcServerCodecFactory): void {
    _serverCodecFactory = factory;
}

export const GGRpc = {
    GET:    (path: string, opts?: {deprecated?: boolean}) => new GGHttpRpcCodec("GET",    path, opts?.deprecated),
    DELETE: (path: string, opts?: {deprecated?: boolean}) => new GGHttpRpcCodec("DELETE", path, opts?.deprecated),
    POST:   (path: string, opts?: {deprecated?: boolean}) => new GGHttpRpcCodec("POST",   path, opts?.deprecated),
    PUT:    (path: string, opts?: {deprecated?: boolean}) => new GGHttpRpcCodec("PUT",    path, opts?.deprecated),
}

class GGHttpRpcCodec implements GGHttpCodec {

    public readonly method: HttpMethod
    public readonly path: string
    public readonly deprecated: boolean | undefined
    public readonly responseHeaders: Record<string, GGSchema<string | undefined>> = {}
    public readonly declaredCookies: GGCookie[] = []

    constructor(method: HttpMethod, path: string, deprecated?: boolean) {
        this.method = method
        this.path = path
        this.deprecated = deprecated
    }

    /** Declare cookies this route is permitted to emit. Enables GGCookie.issue()/clear() in the handler. */
    public setsCookies(...cookies: GGCookie[]): this {
        this.declaredCookies.push(...cookies)
        return this
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
