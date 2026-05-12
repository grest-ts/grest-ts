import {GG_ANY_PERMISSION, GG_NO_PERMISSIONS, GGPermission} from "./GGPermission";

export function describePermission(p: GGPermission | undefined): string {
    if (p === undefined) return "undefined";
    if (p === GG_NO_PERMISSIONS) return "GG_NO_PERMISSIONS";
    if (p === GG_ANY_PERMISSION) return "GG_ANY_PERMISSION";
    if (typeof p === "string") return JSON.stringify(p);
    if ("allOf" in p) return `allOf(${p.allOf.map(describePermission).join(", ")})`;
    if ("anyOf" in p) return `anyOf(${p.anyOf.map(describePermission).join(", ")})`;
    return String(p);
}
