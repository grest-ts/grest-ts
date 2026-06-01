import {GG_ANY_PERMISSION, GG_NO_PERMISSIONS, GGPermission} from "./GGPermission";

export function satisfies(required: GGPermission, scopes: Array<readonly string[]>): boolean {
    if (required === GG_NO_PERMISSIONS) return true
    if (required === GG_ANY_PERMISSION) return scopes.length > 0
    if (typeof required === "string") {
        for (let i = 0; i < scopes.length; i++) {
            if (scopes[i].indexOf(required) >= 0) {
                return true;
            }
        }
        return false
    }
    if (required && typeof required === "object") {
        if ("allOf" in required) return required.allOf.every(p => satisfies(p, scopes))
        if ("anyOf" in required) return required.anyOf.some(p => satisfies(p, scopes))
    }
    return false
}
