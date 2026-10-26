import {GGContractApiDefinition, GGContractClass, GGContractMethod} from "./GGContractClass";
import {GGContractFunction} from "./GGContractFunction";
import {GGPermissionChecker} from "./permission/GGPermissionChecker";

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
        assertNoRequirements(name, def);
        this.name = name;
        this.connect = new GGContractFunction(def.connect);
        this.clientToServer = new GGContractClass(name + ".clientToServer", def.clientToServer);
        this.serverToClient = new GGContractClass(name + ".serverToClient", def.serverToClient);
        Object.freeze(this);
    }
}

/** Requirements need an authority, which only the HTTP server runs. */
export function assertNoRequirements(name: string, def: {connect?: GGContractMethod, clientToServer: GGContractApiDefinition, serverToClient: GGContractApiDefinition}): void {
    const methods: [string, GGContractMethod | undefined][] = [
        ["connect", def.connect],
        ...Object.entries(def.clientToServer).map(([k, m]) => [`clientToServer.${k}`, m] as [string, GGContractMethod]),
        ...Object.entries(def.serverToClient).map(([k, m]) => [`serverToClient.${k}`, m] as [string, GGContractMethod]),
    ]
    for (const [at, m] of methods) {
        if (GGPermissionChecker.requirementsOf(m?.permission).length) throw new Error(`Socket contract ${name}.${at}: requirements are only supported on HTTP methods`)
    }
}
