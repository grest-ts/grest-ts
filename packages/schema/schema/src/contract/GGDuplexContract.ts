import {GGContractApiDefinition, GGContractClass, GGContractMethod} from "./GGContractClass";
import {GGContractFunction} from "./GGContractFunction";

export interface GGDuplexContractDefinition {
    connect: GGContractMethod
    clientToServer: GGContractApiDefinition
    serverToClient: GGContractApiDefinition
}

export class GGDuplexContract<TDef extends GGDuplexContractDefinition> {

    public readonly name: string
    public readonly connect: GGContractFunction<TDef["connect"]>
    public readonly clientToServer: GGContractClass<TDef["clientToServer"]>
    public readonly serverToClient: GGContractClass<TDef["serverToClient"]>

    constructor(name: string, def: TDef) {
        this.name = name;
        this.connect = new GGContractFunction(def.connect);
        this.clientToServer = new GGContractClass(name + ".clientToServer", def.clientToServer);
        this.serverToClient = new GGContractClass(name + ".serverToClient", def.serverToClient);
        Object.freeze(this);
    }
}
