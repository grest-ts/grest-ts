import type {GGAuthzRole} from "./authzSchemas"

export const MAX_DEPTH = 64

/** `onUnknown` returning true skips the pattern instead of throwing. */
export type OnUnknownAction = (pattern: string) => boolean

export function expandActions(known: ReadonlyMap<string, unknown>, patterns: readonly string[], onUnknown?: OnUnknownAction): Set<string> {
    const out = new Set<string>()
    for (const p of patterns) {
        const matched = p.endsWith(":*") ? [...known.keys()].filter(a => a.startsWith(p.slice(0, -1))) : known.has(p) ? [p] : []
        if (!matched.length && onUnknown?.(p)) continue
        if (!matched.length) throw new Error(`Unknown action ${p}`)
        for (const a of matched) out.add(a)
    }
    return out
}

/** Role name → its actions, including those of the roles it includes. Throws on unknown or cyclic includes. */
export function expandRoles(known: ReadonlyMap<string, unknown>, roles: readonly GGAuthzRole[], onUnknown?: (role: string) => OnUnknownAction | undefined): Map<string, Set<string>> {
    const byName = new Map<string, GGAuthzRole>()
    for (const r of roles) {
        if (byName.has(r.name)) throw new Error(`Duplicate role ${r.name}`)
        byName.set(r.name, r)
    }
    const out = new Map<string, Set<string>>()
    const visit = (name: string, path: string[]): Set<string> => {
        const done = out.get(name)
        if (done) return done
        const role = byName.get(name)
        if (!role) throw new Error(`Unknown role ${name}${path.length ? ` (included by ${path[path.length - 1]})` : ""}`)
        if (path.includes(name)) throw new Error(`Role includes form a cycle: ${[...path, name].join(" → ")}`)
        const actions = expandActions(known, role.actions ?? [], onUnknown?.(name))
        for (const included of role.includes ?? []) for (const a of visit(included, [...path, name])) actions.add(a)
        out.set(name, actions)
        return actions
    }
    for (const name of byName.keys()) visit(name, [])
    return out
}
