import {GGWebSocketMiddleware} from "./GGWebSocketMiddleware";
import {GGContractApiDefinition, GGContractClass, GGPermission, GGValidator} from "@grest-ts/schema";

/**
 * WebSocket API Schema - pure data definition with typed context
 *
 * Type parameters:
 * - TClientToServer: Client-facing type for clientToServer methods (returns GGPromise)
 * - TServerToClient: Client-facing type for serverToClient methods (returns GGPromise)
 * - TContext: Accumulated context type (parseHandshake return types)
 * - TQuery: Query parameters on connect
 * - TClientToServerImpl: Server implementation type for clientToServer handlers (returns Promise)
 */
export class GGWebSocketSchema<
    TClientToServer,
    TServerToClient,
    TContext = {},
    TQuery = undefined,
    TClientToServerImpl = TClientToServer,
    TServerToClientImpl = TServerToClient
> {
    public readonly name: string
    public readonly path: string
    public readonly middlewares: readonly GGWebSocketMiddleware[]
    public readonly queryValidator?: GGValidator<TQuery>
    public readonly connectPermission?: GGPermission
    private readonly contractFactory: () => GGWebSocketContractRuntime
    private contractCache: GGWebSocketContractRuntime | null = null

    constructor(
        name: string,
        path: string,
        contractFactory: () => GGWebSocketContractRuntime,
        middlewares: readonly GGWebSocketMiddleware[] = [],
        queryValidator?: GGValidator<TQuery>,
        connectPermission?: GGPermission
    ) {
        this.name = name
        this.path = path
        this.middlewares = middlewares
        this.queryValidator = queryValidator
        this.connectPermission = connectPermission
        this.contractFactory = contractFactory
        Object.freeze(this.middlewares)
    }

    get contract(): GGWebSocketContractRuntime {
        if (!this.contractCache) {
            this.contractCache = this.contractFactory()
        }
        Object.freeze(this)
        return this.contractCache
    }
}

/**
 * Runtime contract structure for WebSocket APIs.
 * Contains GGContractClass instances for proper validation via implement().
 */
export interface GGWebSocketContractRuntime {
    apiName: string
    clientToServer: GGContractClass<GGContractApiDefinition>
    serverToClient: GGContractClass<GGContractApiDefinition>
}
