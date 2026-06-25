import {GGContractMethod} from "./GGContractClass";
import {GGContractFunction} from "./GGContractFunction";

export interface GGRawSocketContractDefinition {
    connect: GGContractMethod
    customClient?: boolean
    protocols?: readonly string[]
}

/**
 * Byte-stream socket contract — sibling of GGDuplexContract. Documents only `connect`
 * (path/auth/query/connect-errors); the body is opaque bytes, so there are no message maps.
 *
 * `customClient: true` is the foreign-passthrough mode (the client is not grest-ts: auth runs
 * at the HTTP upgrade, no in-band handshake, no grest-ts client). `protocols` (subprotocol echo)
 * applies only then. Default is a grest-ts-both-ends byte stream with handshake auth.
 */
export class GGRawSocketContract<TDef extends GGRawSocketContractDefinition> {

    public readonly name: string
    public readonly connect: GGContractFunction<TDef["connect"]>
    public readonly customClient: boolean
    public readonly protocols?: readonly string[]

    constructor(name: string, def: TDef) {
        this.name = name;
        this.connect = new GGContractFunction(def.connect);
        this.customClient = def.customClient === true;
        this.protocols = def.protocols;
        Object.freeze(this);
    }
}
