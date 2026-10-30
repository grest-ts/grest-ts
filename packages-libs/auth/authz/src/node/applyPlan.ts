import {evalConditional, isResourceKey, type Tri} from "./conditions"
import {GGAuthzRn} from "../shared/GGAuthzRn"
import type {GGAuthzPlan, GGAuthzPlanFilter} from "../shared/authzSchemas"

export interface GGAuthzApplyPlanOptions {
    resolver: {
        ancestors(rn: string): readonly string[]
        attributes?(rn: string): Readonly<Record<string, unknown>> | undefined
    }
    /** Per-row facts; `undefined` = unknown. */
    facts?: (name: string, rn: string) => boolean | undefined
}

export function applyPlan(plan: GGAuthzPlan, rns: readonly string[], options: GGAuthzApplyPlanOptions): string[] {
    if (!plan.include.length) return []
    const facts = options.facts ?? (() => undefined)
    return rns.filter(rn => {
        if (GGAuthzRn.type(rn) !== plan.resourceType) return false
        const scopes = new Set([rn, ...options.resolver.ancestors(rn)])
        const attributes = options.resolver.attributes?.(rn)
        const get = (key: string) => key === "resource.rn" ? rn : isResourceKey(key) ? attributes?.[key.slice(9)] : plan.values?.[key]
        const fact = (name: string) => facts(name, rn)
        const match = (f: GGAuthzPlanFilter): Tri => {
            if (f.within && !scopes.has(f.within)) return false
            if (f.exceptWithin?.some(s => scopes.has(s))) return false
            if (f.resources && !f.resources.some(m => GGAuthzRn.isExact(m) ? rn === m.slice(1) : GGAuthzRn.isPattern(m) ? rn.startsWith(m.slice(0, -1)) : scopes.has(m))) return false
            return evalConditional(f, fact, get)
        }
        return plan.include.some(f => match(f) === true)
            && !plan.exclude.some(f => match(f) !== false)
            && plan.require.every(r => (r.within !== undefined && !scopes.has(r.within)) || r.anyOf.some(f => match(f) === true))
    })
}
