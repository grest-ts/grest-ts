import {GGContractApiDefinition, GGContractMethod} from "./GGContractClass";
import {GGDuplexContract} from "./GGDuplexContract";

export interface GGDuplexExtendableContractDefinition {
    connect: GGContractMethod
}

const parents = new WeakMap<GGDuplexContract<any>, GGDuplexExtendableContract<any>>()

/** The extendable contract a child was produced from via `.extend()`, or undefined for a standalone contract. */
export function getExtendableContractParent(contract: GGDuplexContract<any>): GGDuplexExtendableContract<any> | undefined {
    return parents.get(contract);
}

/**
 * A duplex contract that fixes `connect` but lets feature modules contribute their methods later
 * via `.extend()`. Each extension is a standalone `GGDuplexContract` that reuses this contract's
 * `connect` by reference, so several modules multiplex over one socket without a central method
 * list. This instance is the sharing key — see GGWebSocketExtendableSchema.
 */
export class GGDuplexExtendableContract<TBase extends GGDuplexExtendableContractDefinition> {

    public readonly name: string
    private readonly connect: GGContractMethod
    private readonly childNames = new Set<string>()

    constructor(name: string, def: TBase) {
        this.name = name;
        this.connect = def.connect;
    }

    public extend<TC2S extends GGContractApiDefinition = {}, TS2C extends GGContractApiDefinition = {}>(
        name: string,
        ext: {clientToServer?: TC2S; serverToClient?: TS2C}
    ): GGDuplexContract<{
        connect: TBase["connect"]
        clientToServer: TC2S
        serverToClient: TS2C
    }> {
        if (this.childNames.has(name)) {
            throw new Error(`Duplicate extension "${name}" on extendable contract "${this.name}"`);
        }
        this.childNames.add(name);
        const contract = new GGDuplexContract(name, {
            connect: this.connect,
            clientToServer: ext.clientToServer ?? {},
            serverToClient: ext.serverToClient ?? {},
        });
        parents.set(contract, this);
        return contract as any;
    }
}
