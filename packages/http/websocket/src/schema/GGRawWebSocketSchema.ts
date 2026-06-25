import type {GGTransportMiddleware} from "@grest-ts/context";
import {GGRawSocketContract, GGRawSocketContractDefinition} from "@grest-ts/schema";
import {assertValidSocketPath} from "./socketPath";

export interface GGRawWebSocketSchemaConfig<TDef> {
    contract: GGRawSocketContract<TDef & GGRawSocketContractDefinition>
    path: string
    use?: readonly GGTransportMiddleware[]
}

/**
 * Byte-stream WebSocket API schema — opaque bytes, no message contract. Carries the same
 * connection-level concerns as a typed schema (path, auth wires, connect query/permission/errors
 * via `contract.connect`); once authenticated, the application owns the wire as an opaque byte
 * stream. `startServer`/`createClient` are attached by the server/client modules.
 *
 * The type parameter is intentionally unconstrained — see GGWebSocketSchema for why (TS2428).
 */
export class GGRawWebSocketSchema<TDef> {
    public readonly name: string;
    public readonly path: string;
    public readonly middlewares: readonly GGTransportMiddleware[];
    public readonly contract: GGRawSocketContract<TDef & GGRawSocketContractDefinition>;
    public readonly customClient: boolean;
    public readonly protocols?: readonly string[];
    public readonly raw = true as const;

    constructor(config: GGRawWebSocketSchemaConfig<TDef>) {
        const contract = config.contract
        assertValidSocketPath(config.path, contract.name, contract.customClient)
        // A custom client is foreign and never sends the in-band handshake, so a wire that
        // delivers its credential there (an update() writer, e.g. GGHeader) could never arrive —
        // the socket would open unauthenticated while looking gated. Only upgrade-readable
        // credentials (cookie, ?query=) are legal with a custom client.
        const use = config.use ?? []
        if (contract.customClient && use.some(m => typeof m.update === "function")) {
            throw new Error(
                `GGRawWebSocketSchema "${contract.name}": a customClient byte socket cannot use a credential ` +
                `delivered via the grest-ts handshake (a wire with update(), e.g. GGHeader). A custom client is ` +
                `foreign and never sends the in-band handshake, so this credential could never arrive and the ` +
                `socket would open unauthenticated. Authenticate via a cookie or "?query=" credential instead.`
            )
        }
        this.name = contract.name;
        this.path = config.path;
        this.middlewares = Object.freeze([...use]);
        this.contract = contract;
        this.customClient = contract.customClient;
        this.protocols = contract.protocols ? Object.freeze([...contract.protocols]) : undefined;
    }
}
