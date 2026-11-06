import {GGContextKey, type GGConnectionSettings, type GGHeaderSchema, type GGInbound, type GGOutbound, type GGResponse, type GGTransportMiddleware} from "@grest-ts/context"
import {IsNumber} from "@grest-ts/schema"
import {GGWireContextKey} from "./GGWireContextKey"

let nextAlternativesId = 0

type Verifiable = {hasHandler?(): boolean}

/**
 * Lets one schema accept any one of several credentials, e.g. a browser's user token or an agent's token:
 *
 *   use: [new GGWireAlternatives([USER_TOKEN, ORG_TOKEN], [AGENT_TOKEN, AGENT_WORKSPACE]), AUTHORITY]
 *
 * The first group whose `.define()`d wire the request carried runs (else the first group); the others' values
 * are dropped and grant nothing. See the http README, "Alternative wires".
 */
export class GGWireAlternatives implements GGTransportMiddleware {

    public readonly groups: readonly (readonly GGWireContextKey[])[]
    public readonly wires: readonly GGTransportMiddleware[]
    public readonly headers: Readonly<Record<string, GGHeaderSchema>>
    public readonly responseHeaders: Readonly<Record<string, GGHeaderSchema>>
    public readonly cookieParams: Readonly<Record<string, GGHeaderSchema>>
    private readonly chosen = new GGContextKey<number>(`wireAlternatives:${nextAlternativesId++}`, IsNumber)

    constructor(...groups: readonly GGWireContextKey[][]) {
        if (groups.length < 2 || groups.some(g => g.length === 0)) {
            throw new Error("GGWireAlternatives needs at least two non-empty groups of wires.")
        }
        this.groups = Object.freeze(groups.map(g => Object.freeze([...g])))
        this.wires = Object.freeze(groups.flat())
        this.headers = Object.freeze(Object.assign({}, ...this.wires.map(w => w.headers ?? {})))
        this.responseHeaders = Object.freeze(Object.assign({}, ...this.wires.map(w => w.responseHeaders ?? {})))
        this.cookieParams = Object.freeze(Object.assign({}, ...this.wires.map(w => w.cookieParams ?? {})))
        Object.freeze(this)
    }

    /** The group a client sends: the first one holding any value, else the first. */
    public outboundWires(): readonly GGWireContextKey[] {
        return this.groups.find(g => g.some(w => w.get() !== undefined)) ?? this.groups[0]!
    }

    public update(outbound: GGOutbound): void {
        for (const w of this.outboundWires()) (w as GGTransportMiddleware).update?.(outbound)
    }

    public connectionSettings(settings: GGConnectionSettings): void {
        for (const w of this.outboundWires()) (w as GGTransportMiddleware).connectionSettings?.(settings)
    }

    public parse(inbound: GGInbound): void {
        for (const w of this.wires) w.parse?.(inbound)
    }

    public async process(): Promise<void> {
        // Only a verified wire picks its group: an ambient hint alone must not steer the request past the first group.
        const chosen = Math.max(0, this.groups.findIndex(g => g.some(w => (w as Verifiable).hasHandler?.() && w.get() !== undefined)))
        this.chosen.set(chosen)
        this.groups.forEach((g, i) => {
            if (i !== chosen) for (const w of g) if (w.has()) w.delete()
        })
        for (const w of this.groups[chosen]!) await (w as GGTransportMiddleware).process?.()
    }

    /** The wires of the group this request authenticated with; none before process(). */
    public activeWires(): readonly GGWireContextKey[] {
        const chosen = this.chosen.get()
        return chosen === undefined ? [] : this.groups[chosen]!
    }

    public clear(): void {
        for (const w of this.wires) w.clear?.()
    }

    public respond(response: GGResponse): void {
        for (const w of this.wires) w.respond?.(response)
    }
}

/** The middlewares a client sends, each GGWireAlternatives replaced by its outbound group. */
export function outboundWires(middlewares: readonly GGTransportMiddleware[]): GGTransportMiddleware[] {
    return middlewares.flatMap((mw): readonly GGTransportMiddleware[] => mw instanceof GGWireAlternatives ? mw.outboundWires() : [mw])
}

/** The middlewares with each GGWireAlternatives replaced by its wires. */
export function expandWireAlternatives(middlewares: readonly GGTransportMiddleware[]): GGTransportMiddleware[] {
    return middlewares.flatMap((mw): readonly GGTransportMiddleware[] => mw instanceof GGWireAlternatives ? mw.wires : [mw])
}
