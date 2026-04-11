import {ERROR, ERROR_JSON, GGContractApiDefinition, GGContractClass, GGContractMethod, OK} from "@grest-ts/schema";
import type {HttpMethod} from "@grest-ts/common";
import type http from "http";
import type {GGHttpServerMiddleware} from "../server/GGHttpSchema.startServer";

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

export interface GGHttpCodec {
    readonly method: HttpMethod;
    readonly path: string;

    createForClient(config: ClientHttpRouteToRpcTransformClientConfig): ClientHttpRouteToRpcTransformClientCodec

    createForServer(config: ClientHttpRouteToRpcTransformServerConfig): ClientHttpRouteToRpcTransformServerCodec

}

// --------------------------------------------------------------------------------------------------------
// Middleware
// --------------------------------------------------------------------------------------------------------

export interface GGHttpTransportMiddleware {
    /**
     * HTTP header names that this middleware reads from or writes to.
     * Used for automatic CORS Access-Control-Allow-Headers configuration.
     *
     * Populated automatically by useHeader(). For custom middleware via use(),
     * you must declare every custom header your middleware touches.
     * Use [] if the middleware does not use any custom headers.
     */
    readonly headers: readonly string[];

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
