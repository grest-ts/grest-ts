import {GG_ANY_PERMISSION, GG_NO_PERMISSIONS, GGPermission} from "./GGPermission";

export function satisfies(required: GGPermission, scopes: ReadonlySet<string>): boolean {
    if (required === GG_NO_PERMISSIONS) return true
    if (required === GG_ANY_PERMISSION) return scopes.size > 0
    if (typeof required === "string") return scopes.has(required)
    if ("allOf" in required) return required.allOf.every(p => satisfies(p, scopes))
    if ("anyOf" in required) return required.anyOf.some(p => satisfies(p, scopes))
    return false
}
