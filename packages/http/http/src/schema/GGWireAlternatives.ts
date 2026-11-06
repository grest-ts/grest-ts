import {GGContextKey, type GGConnectionSettings, type GGHeaderSchema, type GGInbound, type GGOutbound, type GGResponse, type GGTransportMiddleware} from "@grest-ts/context"
import {IsNumber} from "@grest-ts/schema"
import {GGWireContextKey} from "./GGWireContextKey"

let nextAlternativesId = 0

/**
 * Lets one schema accept any one of several credentials, e.g. a browser's user token or an agent's token:
 *
 *   use: [new GGWireAlternatives([USER_TOKEN, ORG_TOKEN], [AGENT_TOKEN, AGENT_WORKSPACE]), AUTHORITY]
 *
 * Each group is a set of wires that authenticate together (AND, as when listed in `use`). The first
 * group whose request carried any of its wires runs; the others' values are dropped. When none did,
 * the first group runs, so its required wire refuses the request. A client sends whichever wires it
 * holds a value for. Only the chosen group's wires add grants to the permission gate.
 */
export class GGWireAlternatives implements GGTransportMiddleware {

    public readonly groups: readonly (readonly GGWireContextKey[])[]
    public readonly wires: readonly GGWireContextKey[]
    public readonly headers: Readonly<Record<string, GGHeaderSchema>>
    public readonly cookieParams: Readonly<Record<string, GGHeaderSchema>>
    private readonly chosen = new GGContextKey<number>(`wireAlternatives:${nextAlternativesId++}`, IsNumber)

    constructor(...groups: readonly GGWireContextKey[][]) {
        if (groups.length < 2 || groups.some(g => g.length === 0)) {
            throw new Error("GGWireAlternatives needs at least two non-empty groups of wires.")
        }
        this.groups = Object.freeze(groups.map(g => Object.freeze([...g])))
        this.wires = Object.freeze(groups.flat())
        this.headers = Object.freeze(Object.assign({}, ...this.wires.map(w => w.headers ?? {})))
        this.cookieParams = Object.freeze(Object.assign({}, ...this.wires.map(w => (w as GGTransportMiddleware).cookieParams ?? {})))
        Object.freeze(this)
    }

    public update(outbound: GGOutbound): void {
        for (const w of this.wires) (w as GGTransportMiddleware).update?.(outbound)
    }

    public connectionSettings(settings: GGConnectionSettings): void {
        for (const w of this.wires) (w as GGTransportMiddleware).connectionSettings?.(settings)
    }

    public parse(inbound: GGInbound): void {
        for (const w of this.wires) (w as GGTransportMiddleware).parse?.(inbound)
    }

    public async process(): Promise<void> {
        const chosen = Math.max(0, this.groups.findIndex(g => g.some(w => w.get() !== undefined)))
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
        for (const w of this.wires) (w as GGTransportMiddleware).clear?.()
    }

    public respond(response: GGResponse): void {
        for (const w of this.wires) (w as GGTransportMiddleware).respond?.(response)
    }
}

/** The middlewares with each GGWireAlternatives replaced by its wires. */
export function expandWireAlternatives(middlewares: readonly GGTransportMiddleware[]): GGTransportMiddleware[] {
    return middlewares.flatMap((mw): readonly GGTransportMiddleware[] => mw instanceof GGWireAlternatives ? mw.wires : [mw])
}
