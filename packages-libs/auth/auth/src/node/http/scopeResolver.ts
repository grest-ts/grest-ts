import type {AuthGuard} from "./AuthGuard"

// Scope resolver for the grest-ts gate: union of every present token kind's permissions.
// null = nothing authenticated (gate → NOT_AUTHORIZED); empty set = authenticated, no perms (gate → FORBIDDEN).
export function scopeResolver(guards: ReadonlyArray<AuthGuard<any, any>>) {
    return (): ReadonlySet<string> | null => {
        const scopes = new Set<string>()
        let authenticated = false
        for (const guard of guards) {
            const payload = guard.payload()
            if (!payload) continue
            authenticated = true
            for (const permission of payload.permissions) scopes.add(permission)
        }
        return authenticated ? scopes : null
    }
}
