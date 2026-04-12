import type http from "http";
import {GGHttpCodec, GGHttpSchema} from "./GGHttpSchema";
import {GGHttpRequest, GGHttpTransportMiddleware} from "./GGHttpSchema";
import {GGContractApiDefinition, GGContractClass, GGSchema} from "@grest-ts/schema";
import {GGContextKey} from "@grest-ts/context";

/**
 * Create an HTTP API schema builder from a contract.
 *
 * @example
 * export const MyApiContract = defineApi("MyApi", () => ({
 *     list: {
 *         success: IsArray(IsItem),
 *         errors: [NOT_AUTHORIZED, SERVER_ERROR]
 *     },
 *     create: {
 *         input: IsCreateRequest,
 *         success: IsItem,
 *         errors: [NOT_AUTHORIZED, VALIDATION_ERROR, SERVER_ERROR]
 *     }
 * }))
 *
 * export const MyApi = httpApi(MyApiContract)
 *     .pathPrefix("api/items")
 *     .use(AuthMiddleware)
 *     .routes({
 *         list: GGRpc.GET("list"),
 *         create: GGRpc.POST("create")
 *     })
 */
export function httpSchema<TContract extends GGContractApiDefinition>(
    contract: GGContractClass<TContract>
): GGHttpSchemaBuilder<TContract> {
    return new GGHttpSchemaBuilder(contract)
}

class GGHttpSchemaBuilder<TContract extends GGContractApiDefinition, TContext = undefined> {

    private readonly _contract: GGContractClass<TContract>
    private _pathPrefix: string = ""
    private _middlewares: GGHttpTransportMiddleware[] = []

    constructor(contract: GGContractClass<TContract>) {
        this._contract = contract;
    }

    pathPrefix(prefix: string): this {
        this._pathPrefix = prefix
        return this
    }

    use<M extends GGHttpTransportMiddleware>(middleware: M): GGHttpSchemaBuilder<TContract, TContext | M> {
        this._middlewares.push(middleware)
        return this as unknown as GGHttpSchemaBuilder<TContract, TContext | M>
    }

    useHeader<Input>(contextKey: GGContextKey<Input>): GGHttpSchemaBuilder<TContract, TContext | Input> {
        const codec = contextKey.getCodec("http");
        if (!codec) {
            throw new Error(`Context key '${contextKey.name}' does not have an 'http-header' codec registered.`);
        }

        // Build the typed header schema from the codec's input schema (an IsObject describing headers).
        // GGCodec wraps a GGTransform; the raw transform's inputSchema is the IsObject({headerName: schema}).
        const rawCodec = codec as any;
        const inputSchema: unknown = rawCodec?.config?.encode?.inputSchema ?? rawCodec?.encode?.inputSchema;
        const headers: Record<string, GGSchema<string | undefined>> =
            inputSchema instanceof GGSchema && inputSchema.toSchemaDescription().node.kind === 'object'
                ? Object.fromEntries(
                    Object.entries(
                        (inputSchema.toSchemaDescription().node as { kind: 'object'; properties: Record<string, import('@grest-ts/schema').GGSchemaDescription>; required: string[] }).properties
                    ).map(([k, desc]) => [k, desc.schema as GGSchema<string | undefined>])
                ) : {};

        const middleware: GGHttpTransportMiddleware = {
            headers,
            responseHeaders: {},
            updateRequest(req: GGHttpRequest) {
                const contextValue = contextKey.get();
                if (contextValue !== undefined) {
                    const result = codec.decode(contextValue);
                    if (result.success) {
                        Object.assign(req.headers, result.value);
                    }
                } else {
                    const emptyResult = codec.decode({} as Input);
                    if (emptyResult.success) {
                        for (const key of Object.keys(emptyResult.value as object)) {
                            delete req.headers[key];
                        }
                    }
                }
            },
            parseRequest(req: http.IncomingMessage) {
                const headers = req.headers as Record<string, string>;
                const result = codec.encode(headers);
                if (result.success) {
                    contextKey.set(result.value);
                }
            }
        };

        this._middlewares.push(middleware);
        return this as unknown as GGHttpSchemaBuilder<TContract, TContext | Input>;
    }

    routes(mapping: { [K in keyof TContract]: GGHttpCodec }): GGHttpSchema<TContract, TContext> {
        return new GGHttpSchema(this._pathPrefix, this._contract, mapping, this._middlewares)
    }
}
