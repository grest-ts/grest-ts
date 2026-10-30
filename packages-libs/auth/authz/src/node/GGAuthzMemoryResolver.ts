import {MAX_DEPTH} from "../shared/chain"
import type {GGAuthzResolver} from "./GGAuthz"

export interface GGAuthzMemoryData {
    /** rn → parent rn */
    parents?: Record<string, string>
    /** principal (`<type>:<id>`) → group selectors (`group:<id>`), already transitive */
    groups?: Record<string, string[]>
    /** principal key or rn → attributes */
    attributes?: Record<string, Record<string, unknown>>
}

export class GGAuthzMemoryResolver implements GGAuthzResolver {

    private readonly parents: Map<string, string>
    private readonly members: Map<string, string[]>
    private readonly attrs: Map<string, Record<string, unknown>>

    constructor(data: GGAuthzMemoryData) {
        this.parents = new Map(Object.entries(data.parents ?? {}))
        this.members = new Map(Object.entries(data.groups ?? {}))
        this.attrs = new Map(Object.entries(data.attributes ?? {}))
    }

    // Stops one past a repeat or past MAX_DEPTH, so the engine sees the cycle.
    public ancestors(rn: string): readonly string[] {
        const out: string[] = []
        const seen = new Set([rn])
        for (let parent = this.parents.get(rn); parent !== undefined && out.length <= MAX_DEPTH; parent = this.parents.get(parent)) {
            out.push(parent)
            if (seen.has(parent)) break
            seen.add(parent)
        }
        return out
    }

    public groups(principal: string): readonly string[] {
        return this.members.get(principal) ?? []
    }

    public attributes(entity: string): Readonly<Record<string, unknown>> | undefined {
        return this.attrs.get(entity)
    }
}
