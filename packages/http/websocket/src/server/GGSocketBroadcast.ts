import {GGLog} from "@grest-ts/logger";
import type {GGContractClient, GGDuplexContractDefinition} from "@grest-ts/schema";
import type {GGWebSocketSchema} from "../schema/GGWebSocketSchema";
import type {WebSocketOutgoing} from "../socket/WebSocketTypes";

type Client<TDef extends GGDuplexContractDefinition> = GGContractClient<TDef["serverToClient"]>;
type Outgoing<TDef extends GGDuplexContractDefinition> = WebSocketOutgoing<Client<TDef>>;
type Frame = [method: string, data: unknown];

export type GGSocketBroadcastOut<TDef extends GGDuplexContractDefinition> = {
    [K in keyof Client<TDef>]: (...args: Parameters<Client<TDef>[K]>) => void
};

/**
 * Server→client fan-out to every joined connection of one socket schema. `out` mirrors the
 * contract's `serverToClient`; each call is sent to all members, fire-and-forget.
 */
export class GGSocketBroadcast<TDef extends GGDuplexContractDefinition> {

    public readonly out: GGSocketBroadcastOut<TDef>;

    /** Live members map to `null`; members still being seeded map to their queued frames. */
    private readonly members = new Map<Outgoing<TDef>, Frame[] | null>();
    private readonly watched = new WeakSet<Outgoing<TDef>>();

    constructor(schema: GGWebSocketSchema<TDef>) {
        const out: Record<string, (data: unknown) => void> = {};
        for (const method of Object.keys(schema.contract.serverToClient.methods)) {
            out[method] = (data: unknown) => this.send(method, data);
        }
        this.out = out as unknown as GGSocketBroadcastOut<TDef>;
    }

    /**
     * Adds the connection until it closes. With `seed`, the connection receives whatever `seed`
     * sends first; broadcasts made while `seed` runs are queued and delivered right after it, so
     * they may overlap the seeded state but are never lost. Joining again with a `seed` re-seeds
     * (the newest seed wins); a throwing `seed` leaves the connection out.
     */
    public async join(outgoing: Outgoing<TDef>, seed?: (outgoing: Outgoing<TDef>) => void | Promise<void>): Promise<void> {
        if (!this.watched.has(outgoing)) {
            this.watched.add(outgoing);
            outgoing.onClose(() => this.members.delete(outgoing));
        }
        if (!seed) {
            if (!this.members.has(outgoing)) this.members.set(outgoing, null);
            return;
        }
        const queue: Frame[] = [];
        this.members.set(outgoing, queue);
        try {
            await seed(outgoing);
        } catch (error) {
            if (this.members.get(outgoing) === queue) this.members.delete(outgoing);
            throw error;
        }
        if (this.members.get(outgoing) !== queue) return;
        this.members.set(outgoing, null);
        for (const [method, data] of queue) void this.deliver(outgoing, method, data);
    }

    private send(method: string, data: unknown): void {
        for (const [outgoing, queue] of this.members) {
            if (queue) queue.push([method, data]);
            else void this.deliver(outgoing, method, data);
        }
    }

    private async deliver(outgoing: Outgoing<TDef>, method: string, data: unknown): Promise<void> {
        try {
            await (outgoing as Record<string, (data: unknown) => unknown>)[method](data);
        } catch (error) {
            GGLog.warn(this, "Broadcast send failed", {method, error: (error as Error).message});
        }
    }
}
