import {GGWebSocketSchema, GGWebSocketContractRuntime} from "./GGWebSocketSchema";
import {GGWebSocketMiddleware} from "./GGWebSocketMiddleware";
import {GGContractClass, GGContractClient, GGContractImplementation, GGContractMethod, GGValidator} from "@grest-ts/schema";

/**
 * Bidirectional websocket contract methods.
 *
 * Both directions use GGContractMethod (which requires `permission`), but only
 * the `clientToServer` permission is enforced by the gate — server-pushed
 * messages have no caller identity to check against. By convention, set
 * `serverToClient` methods to `permission: GG_NO_PERMISSIONS`.
 */
export interface GGSocketContractMethods {
    clientToServer: Record<string, GGContractMethod>
    serverToClient: Record<string, GGContractMethod>
}

/**
 * WebSocket contract definition
 */
export interface GGSocketContract<TDef extends GGSocketContractMethods = GGSocketContractMethods> {
    name: string
    methods: TDef
}

/**
 * Create a websocket contract
 */
export function defineSocketContract<TDef extends GGSocketContractMethods>(
    name: string,
    methods: TDef
): GGSocketContract<TDef> {
    return {name, methods}
}

/**
 * Create a WebSocket API schema builder from a contract.
 *
 * @example
 * export const ChatContract = defineSocketContract("Chat", {
 *     clientToServer: {
 *         sendMessage: { input: IsMessage, success: IsVoid, errors: [SERVER_ERROR] }
 *     },
 *     serverToClient: {
 *         onMessage: { input: IsMessage }
 *     }
 * })
 *
 * export const ChatApi = webSocketSchema(ChatContract)
 *     .path("/chat")
 *     .use(AuthMiddleware)
 *     .done()
 */
export function webSocketSchema<TDef extends GGSocketContractMethods>(
    contract: GGSocketContract<TDef>
): GGWebSocketSchemaBuilder<
    GGContractClient<TDef["clientToServer"]>,
    GGContractClient<TDef["serverToClient"]>,
    undefined,
    undefined,
    GGContractImplementation<TDef["clientToServer"]>,
    GGContractImplementation<TDef["serverToClient"]>
> {
    return new GGWebSocketSchemaBuilder(contract)
}

class GGWebSocketSchemaBuilder<
    TClientToServer,
    TServerToClient,
    TContext = undefined,
    TQuery = undefined,
    TClientToServerImpl = TClientToServer,
    TServerToClientImpl = TServerToClient
> {
    private _path: string = ""
    private _middlewares: GGWebSocketMiddleware[] = []
    private _queryValidator?: GGValidator<any>

    constructor(
        private readonly _contract: GGSocketContract
    ) {
    }

    path(path: string): this {
        this._path = path
        return this
    }

    use<M extends GGWebSocketMiddleware>(middleware: M): GGWebSocketSchemaBuilder<TClientToServer, TServerToClient, TContext | M, TQuery, TClientToServerImpl, TServerToClientImpl> {
        this._middlewares.push(middleware)
        return this as any
    }

    /**
     * Declare the query-parameter shape and validator for connections.
     * The validator runs on the server (connections with invalid query are rejected
     * before handshake) and on the client (invalid query throws before connecting).
     */
    queryOnConnect<TNewQuery>(validator: GGValidator<TNewQuery>): GGWebSocketSchemaBuilder<TClientToServer, TServerToClient, TContext, TNewQuery, TClientToServerImpl, TServerToClientImpl> {
        this._queryValidator = validator
        return this as any
    }

    done(): GGWebSocketSchema<TClientToServer, TServerToClient, TContext, TQuery, TClientToServerImpl, TServerToClientImpl> {
        const contract = this._contract;
        const contractFactory = (): GGWebSocketContractRuntime => {
            const methods = contract.methods;
            const name = contract.name;
            return {
                apiName: name,
                clientToServer: new GGContractClass(name + ".clientToServer", methods.clientToServer),
                serverToClient: new GGContractClass(name + ".serverToClient", methods.serverToClient)
            };
        };

        return new GGWebSocketSchema<TClientToServer, TServerToClient, TContext, TQuery, TClientToServerImpl, TServerToClientImpl>(
            contract.name,
            this._path,
            contractFactory,
            this._middlewares,
            this._queryValidator
        )
    }
}
