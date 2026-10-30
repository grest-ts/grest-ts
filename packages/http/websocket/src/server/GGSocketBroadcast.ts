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

    private readonly methods: readonly string[];
    private readonly live = new Set<Outgoing<TDef>>();
    /** The newest in-flight seed per connection, as the frames broadcast since it started. */
    private readonly seeding = new Map<Outgoing<TDef>, Frame[]>();
    private readonly watched = new WeakSet<Outgoing<TDef>>();

    constructor(schema: GGWebSocketSchema<TDef>) {
        this.methods = Object.keys(schema.contract.serverToClient.methods);
        const out: Record<string, (data: unknown) => void> = {};
        for (const method of this.methods) {
            out[method] = (data: unknown) => this.send(method, data);
        }
        this.out = out as unknown as GGSocketBroadcastOut<TDef>;
    }

    /**
     * Adds the connection until it closes. With `seed`, the connection gets what `seed` sends before
     * any broadcast made while it runs; those are queued and delivered right after it, so they may
     * overlap the seeded state but are never lost. Joining again re-seeds: a newer seed supersedes
     * one still running, whose sends are then dropped. A throwing `seed` keeps an existing
     * membership as it was and leaves a new connection out.
     */
    public async join(outgoing: Outgoing<TDef>, seed?: (outgoing: Outgoing<TDef>) => void | Promise<void>): Promise<void> {
        if (!this.watched.has(outgoing)) {
            this.watched.add(outgoing);
            outgoing.onClose(() => {
                this.live.delete(outgoing);
                this.seeding.delete(outgoing);
            });
        }
        if (!seed) {
            this.live.add(outgoing);
            return;
        }
        const queue: Frame[] = [];
        const isCurrent = () => this.seeding.get(outgoing) === queue;
        this.seeding.set(outgoing, queue);
        try {
            await seed(this.gated(outgoing, isCurrent));
        } catch (error) {
            if (isCurrent()) this.settle(outgoing, queue);
            throw error;
        }
        if (!isCurrent()) return;
        this.live.add(outgoing);
        this.settle(outgoing, queue);
    }

    private settle(outgoing: Outgoing<TDef>, queue: Frame[]): void {
        this.seeding.delete(outgoing);
        if (!this.live.has(outgoing)) return;
        for (const [method, data] of queue) void this.deliver(outgoing, method, data);
    }

    private gated(outgoing: Outgoing<TDef>, isCurrent: () => boolean): Outgoing<TDef> {
        const target = outgoing as Record<string, (data: unknown) => unknown>;
        const gated: Record<string, unknown> = {
            onClose: (callback: () => void) => outgoing.onClose(callback),
            close: () => outgoing.close(),
        };
        for (const method of this.methods) {
            gated[method] = (data: unknown) => isCurrent() ? target[method](data) : undefined;
        }
        return gated as Outgoing<TDef>;
    }

    private send(method: string, data: unknown): void {
        for (const queue of this.seeding.values()) queue.push([method, data]);
        for (const outgoing of this.live) {
            if (!this.seeding.has(outgoing)) void this.deliver(outgoing, method, data);
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
