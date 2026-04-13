import {ERROR, ERROR_JSON, GGContractApiDefinition, GGContractClass, GGContractMethod, GGSchema, GGSchemaDescription, OK} from "@grest-ts/schema";
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
/**
 * Resolves a GGSchemaDescription to an OpenAPI SchemaObject or ReferenceObject.
 * When provided via GGHttpCodecOpenApiConfig, codecs should use this for all schema
 * conversions — it enables $ref extraction for named schemas.
 * For standalone use (tests, custom tools), use inlineSchemaResolver from @grest-ts/openapi.
 */
export type GGOpenApiSchemaResolver = (desc: GGSchemaDescription) => OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject;

export interface GGHttpCodecOpenApiConfig {
    readonly pathPrefix: string;
    readonly methodName: string;
    readonly contract: GGContractMethod;
    /**
     * Resolves a GGSchema to an OpenAPI SchemaObject or ReferenceObject.
     * Provided by the document builder (toOpenApi) as registry.schemaOrRef.
     * For standalone codec use or tests, pass inlineSchemaResolver from @grest-ts/openapi.
     */
    readonly schemaResolver: GGOpenApiSchemaResolver;
}


export interface GGHttpCodec {
    readonly method: HttpMethod;
    readonly path: string;

    /**
     * Mark this operation as deprecated in the OpenAPI spec.
     * Swagger UI renders deprecated operations with a strikethrough.
     * @default false
     */
    readonly deprecated?: boolean;

    /**
     * Response headers this codec sets, mapped to their value schemas.
     * Keys are header names; values describe the header value format.
     * Used for CORS Access-Control-Expose-Headers and OpenAPI response header docs.
     * Use {} if the codec sets no custom response headers.
     */
    readonly responseHeaders: Record<string, GGSchema<string | undefined>>;

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
     * Request headers this middleware reads or writes, mapped to their value schemas.
     * Keys are header names; values describe the header value format for validation and docs.
     * Used for CORS Access-Control-Allow-Headers and OpenAPI parameter docs.
     * Use {} if the middleware touches no custom request headers.
     *
     * @example
     * headers: {
     *   "authorization": IsString.nonEmpty.docs({title: "Bearer token", example: "Bearer ..."}),
     *   "accept-language": IsLocale.orUndefined
     * }
     */
    readonly headers: Record<string, GGSchema<string | undefined>>;

    /**
     * Response headers this middleware sets, mapped to their value schemas.
     * Keys are header names; values describe the header value format for validation and docs.
     * Used for CORS Access-Control-Expose-Headers and OpenAPI response header docs.
     * Use {} if the middleware sets no custom response headers.
     */
    readonly responseHeaders: Record<string, GGSchema<string | undefined>>;

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
