import {ERROR, ERROR_JSON, GGContractApiDefinition, GGContractClass, GGContractMethod, OK} from "@grest-ts/schema";
import type {HttpMethod} from "@grest-ts/common";
import type http from "http";
import type {GGHttpServerMiddleware} from "../server/GGHttpSchema.startServer";
import type {OpenAPIV3_1} from "openapi-types";

export class GGHttpSchema<TContract extends GGContractApiDefinition, TContext> {

    public readonly name: string
    public readonly pathPrefix: string
    public readonly apiMiddlewares: readonly GGHttpTransportMiddleware[]
    public readonly codec: Record<keyof TContract, GGHttpCodec>
    public readonly contract: GGContractClass<TContract> | null = null

    constructor(
        pathPrefix: string,
        contract: GGContractClass<TContract>,
        wireCodec: Record<keyof TContract, GGHttpCodec>,
        middlewares: readonly GGHttpTransportMiddleware[] = []
    ) {
        this.name = contract.name
        this.pathPrefix = pathPrefix
        this.apiMiddlewares = middlewares
        this.codec = wireCodec
        this.contract = contract
        Object.freeze(this.apiMiddlewares)
        Object.freeze(this.codec)
        Object.freeze(this)
    }
}

// --------------------------------------------------------------------------------------------------------
// Client codec
// --------------------------------------------------------------------------------------------------------

export interface ClientHttpRouteToRpcTransformClientConfig {
    pathPrefix: string,
    contract: GGContractMethod,
    middlewares: readonly GGHttpTransportMiddleware[]
}

export interface ClientHttpRouteToRpcTransformClientCodec {
    createRequest: (data: unknown) => GGHttpFetchRequest | Promise<GGHttpFetchRequest>
    parseResponse: (response: Response) => Promise<OK<unknown> | ERROR_JSON<string, unknown>>
}

export interface GGHttpFetchRequest {
    url: string;
    method: HttpMethod;
    headers: Record<string, string>;
    body: string | FormData | undefined;
}

// --------------------------------------------------------------------------------------------------------
// Server codec
// --------------------------------------------------------------------------------------------------------

export interface ClientHttpRouteToRpcTransformServerConfig {
    contract: GGContractMethod,
    apiMiddlewares: readonly GGHttpTransportMiddleware[],
    serverMiddlewares: readonly GGHttpServerMiddleware[]
}

export interface ClientHttpRouteToRpcTransformServerCodec {
    parseRequest: (req: http.IncomingMessage) => Promise<unknown>,
    sendResponse: (res: http.ServerResponse, rpcResult: ERROR<string, unknown> | OK<unknown>) => Promise<void>
}

// --------------------------------------------------------------------------------------------------------
// Codec
// --------------------------------------------------------------------------------------------------------

/**
 * Config passed to toOpenApiOperation? — gives the codec access to the contract and route context
 * so it can produce accurate OpenAPI operation metadata.
 */
export interface GGHttpCodecOpenApiConfig {
    readonly pathPrefix: string;
    readonly methodName: string;
    readonly contract: GGContractMethod;
}

export interface GGHttpCodec {
    readonly method: HttpMethod;
    readonly path: string;

    createForClient(config: ClientHttpRouteToRpcTransformClientConfig): ClientHttpRouteToRpcTransformClientCodec

    createForServer(config: ClientHttpRouteToRpcTransformServerConfig): ClientHttpRouteToRpcTransformServerCodec

    /**
     * Optional hook for custom codecs to describe their OpenAPI operation semantics.
     * The returned partial is merged on top of the auto-generated operation object,
     * allowing overrides for requestBody content type, security schemes, etc.
     *
     * Built-in GGRpc.* codecs implement this automatically.
     * Custom codec authors (e.g. GGFileUpload) may implement it for accurate docs.
     */
    toOpenApiOperation?(config: GGHttpCodecOpenApiConfig): Partial<OpenAPIV3_1.OperationObject>
}

// --------------------------------------------------------------------------------------------------------
// Middleware
// --------------------------------------------------------------------------------------------------------

export interface GGHttpTransportMiddleware {
    /**
     * Client-side: modify outgoing request (add headers, etc.)
     */
    updateRequest?(req: GGHttpRequest): void;

    /**
     * Server-side: parse incoming request (extract context from headers, etc.)
     */
    parseRequest?(req: GGHttpRequest): void;

    /**
     * Server-side: modify outgoing response
     */
    updateResponse?(res: GGHttpResponse): void;

    /**
     * Client-side: parse incoming response
     */
    parseResponse?(res: GGHttpResponse): void;
}

export interface GGHttpRequest {
    headers?: Record<string, string | string[]>;
    queryArgs?: Record<string, string | string[]>;
}

export interface GGHttpResponse {
    headers: Record<string, string | string[]>;
}
