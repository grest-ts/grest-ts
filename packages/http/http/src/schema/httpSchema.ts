import {GGHttpCodec, GGHttpSchema} from "./GGHttpSchema";
import {GGContractApiDefinition, GGContractClass} from "@grest-ts/schema";
import type {GGTransportMiddleware} from "@grest-ts/context";

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
 * @deprecated
 */
export function httpSchema<TContract extends GGContractApiDefinition>(
    contract: GGContractClass<TContract>
): GGHttpSchemaBuilder<TContract> {
    return new GGHttpSchemaBuilder(contract)
}

/**
 * @deprecated
 */
class GGHttpSchemaBuilder<TContract extends GGContractApiDefinition, TContext = undefined> {

    private readonly _contract: GGContractClass<TContract>
    private _pathPrefix: string = ""
    private _middlewares: GGTransportMiddleware[] = []

    constructor(contract: GGContractClass<TContract>) {
        this._contract = contract;
    }

    pathPrefix(prefix: string): this {
        this._pathPrefix = prefix
        return this
    }

    use<M extends GGTransportMiddleware>(middleware: M): GGHttpSchemaBuilder<TContract, TContext | M> {
        this._middlewares.push(middleware)
        return this as unknown as GGHttpSchemaBuilder<TContract, TContext | M>
    }

    routes(mapping: { [K in keyof TContract]: GGHttpCodec }): GGHttpSchema<TContract, TContext> {
        return new GGHttpSchema(this._pathPrefix, this._contract, mapping, this._middlewares)
    }
}
