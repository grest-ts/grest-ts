import type {GGTransportMiddleware} from "@grest-ts/context";
import {
    GGDuplexContract,
    GGDuplexContractDefinition,
    GGDuplexExtendableContract,
    GGDuplexExtendableContractDefinition,
    getExtendableContractParent,
} from "@grest-ts/schema";
import {GGWebSocketSchema} from "./GGWebSocketSchema";
import {assertValidSocketPath} from "./socketPath";

export interface GGWebSocketExtendableSchemaConfig<TBase extends GGDuplexExtendableContractDefinition> {
    contract: GGDuplexExtendableContract<TBase>
    path: string
    use?: readonly GGTransportMiddleware[]
}

/**
 * The anchor for a pooled WebSocket connection: owns `path` + `use`, wraps a
 * `GGDuplexExtendableContract` that owns `connect`. Modules call `.extend(childContract)` to get a
 * regular `GGWebSocketSchema` that inherits this connection and multiplexes over one socket with
 * its siblings. The anchor itself is never bound or connected — only its extensions are.
 */
export class GGWebSocketExtendableSchema<TBase extends GGDuplexExtendableContractDefinition> {

    public readonly contract: GGDuplexExtendableContract<TBase>
    public readonly path: string
    public readonly middlewares: readonly GGTransportMiddleware[]

    constructor(config: GGWebSocketExtendableSchemaConfig<TBase>) {
        assertValidSocketPath(config.path, config.contract.name)
        this.contract = config.contract
        this.path = config.path
        this.middlewares = Object.freeze([...(config.use ?? [])])
        Object.freeze(this)
    }

    public extend<TDef extends GGDuplexContractDefinition>(contract: GGDuplexContract<TDef>): GGWebSocketSchema<TDef> {
        if (getExtendableContractParent(contract) !== this.contract) {
            throw new Error(
                `Socket "${this.path}": contract "${contract.name}" was not created from this group's contract.extend()`
            )
        }
        return new GGWebSocketSchema<TDef>({
            contract,
            path: this.path,
            use: this.middlewares,
            group: this,
        })
    }
}
