import type {GGTransportMiddleware} from "@grest-ts/context";
import {GGContractClient, GGContractImplementation, GGDuplexContract, GGDuplexContractDefinition} from "@grest-ts/schema";
import type {WebSocketIncoming, WebSocketOutgoing} from "../socket/WebSocketTypes";
import {assertValidSocketPath} from "./socketPath";

export interface GGWebSocketSchemaConfig<TDef> {
    contract: GGDuplexContract<TDef & GGDuplexContractDefinition>
    path: string
    use?: readonly GGTransportMiddleware[]
}

/**
 * Typed-duplex WebSocket API schema — binds a `GGDuplexContract` to a transport (path + auth
 * wires). Connection-level concerns (handshake query, connect permission, connect errors) live
 * on `contract.connect`. `startServer`/`createClient` are attached by the server/client modules.
 *
 * The type parameter is intentionally unconstrained: a class declaration and its cross-module
 * `declare module` augmentations (.startServer/.createClient/.callOn) cannot share a *constrained*
 * type parameter (TS2428), so the `GGDuplexContractDefinition` bound is applied on the field/config
 * types via intersection instead.
 *
 * `clientToServer`/`serverToClient` are type-only handles for deriving the server handler
 * types (`typeof MySocket.clientToServer` / `.serverToClient`) — no runtime field, no value.
 */
export class GGWebSocketSchema<TDef> {
    public readonly name: string
    public readonly path: string
    public readonly middlewares: readonly GGTransportMiddleware[]
    public readonly contract: GGDuplexContract<TDef & GGDuplexContractDefinition>
    declare readonly clientToServer: TDef extends GGDuplexContractDefinition ? WebSocketIncoming<GGContractImplementation<TDef["clientToServer"]>> : never
    declare readonly serverToClient: TDef extends GGDuplexContractDefinition ? WebSocketOutgoing<GGContractClient<TDef["serverToClient"]>> : never

    constructor(config: GGWebSocketSchemaConfig<TDef>) {
        assertValidSocketPath(config.path, config.contract.name)
        this.name = config.contract.name
        this.path = config.path
        this.middlewares = Object.freeze([...(config.use ?? [])])
        this.contract = config.contract
        Object.freeze(this)
    }
}
