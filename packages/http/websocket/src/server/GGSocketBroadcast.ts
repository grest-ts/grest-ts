import {GGLog} from "@grest-ts/logger";
import type {GGContractClient, GGDuplexContractDefinition} from "@grest-ts/schema";
import type {GGWebSocketSchema} from "../schema/GGWebSocketSchema";
import type {WebSocketOutgoing} from "../socket/WebSocketTypes";

type Audience<TDef extends GGDuplexContractDefinition> = GGContractClient<TDef["serverToClient"]>;
type Outgoing<TDef extends GGDuplexContractDefinition> = WebSocketOutgoing<Audience<TDef>>;
type Frame = [method: string, data: unknown];

/**
 * Server→client fan-out to every joined connection of one socket schema. `out` mirrors the
 * contract's `serverToClient`; each call is sent to all members, fire-and-forget.
 */
export class GGSocketBroadcast<TDef extends GGDuplexContractDefinition> {

    public readonly out: Audience<TDef>;

    private readonly members = new Set<Outgoing<TDef>>();
    private readonly seeding = new Map<Outgoing<TDef>, Frame[]>();

    constructor(schema: GGWebSocketSchema<TDef>) {
        const out: Record<string, (data: unknown) => void> = {};
        for (const method of Object.keys(schema.contract.serverToClient.methods)) {
            out[method] = (data: unknown) => this.send(method, data);
        }
        this.out = out as Audience<TDef>;
    }

    /**
     * Adds the connection until it closes. With `seed`, the connection receives whatever `seed`
     * sends first; broadcasts made while `seed` runs are queued and delivered right after it, so
     * they may overlap the seeded state but are never lost. A throwing `seed` leaves it out.
     */
    public async join(outgoing: Outgoing<TDef>, seed?: (outgoing: Outgoing<TDef>) => void | Promise<void>): Promise<void> {
        if (this.members.has(outgoing) || this.seeding.has(outgoing)) return;
        let closed = false;
        outgoing.onClose(() => {
            closed = true;
            this.members.delete(outgoing);
            this.seeding.delete(outgoing);
        });
        if (seed) {
            const queue: Frame[] = [];
            this.seeding.set(outgoing, queue);
            try {
                await seed(outgoing);
            } finally {
                this.seeding.delete(outgoing);
            }
            if (closed) return;
            for (const [method, data] of queue) void this.deliver(outgoing, method, data);
        }
        this.members.add(outgoing);
    }

    private send(method: string, data: unknown): void {
        for (const outgoing of this.members) void this.deliver(outgoing, method, data);
        for (const queue of this.seeding.values()) queue.push([method, data]);
    }

    private async deliver(outgoing: Outgoing<TDef>, method: string, data: unknown): Promise<void> {
        try {
            await (outgoing as Record<string, (data: unknown) => unknown>)[method](data);
        } catch (error) {
            GGLog.warn(this, "Broadcast send failed", {method, error: (error as Error).message});
        }
    }
}
