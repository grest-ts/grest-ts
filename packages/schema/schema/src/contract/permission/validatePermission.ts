import {GG_ANY_PERMISSION, GG_NO_PERMISSIONS, GGPermission} from "./GGPermission";

const MAX_DEPTH = 3;

export function validatePermission(permission: GGPermission, path: string = ""): void {
    walk(permission, path, 0);
}

function walk(p: unknown, path: string, depth: number): void {
    if (depth > MAX_DEPTH) {
        throw new Error(`Permission tree too deep at ${path || "root"}: max depth is ${MAX_DEPTH}`);
    }
    if (p === GG_NO_PERMISSIONS || p === GG_ANY_PERMISSION) return;
    if (typeof p === "symbol") {
        throw new Error(`Permission at ${path || "root"} uses an unknown symbol; only GG_NO_PERMISSIONS and GG_ANY_PERMISSION are recognized`);
    }
    if (typeof p === "string") {
        if (p.length === 0) throw new Error(`Permission scope at ${path || "root"} must be a non-empty string`);
        return;
    }
    if (p !== null && typeof p === "object") {
        if ("allOf" in p) {
            const here = `${path}.allOf`;
            const list = (p as {allOf: unknown}).allOf;
            if (!Array.isArray(list) || list.length === 0) {
                throw new Error(`Permission at ${here} must contain at least one entry`);
            }
            list.forEach((c, i) => walk(c, `${here}[${i}]`, depth + 1));
            return;
        }
        if ("anyOf" in p) {
            const here = `${path}.anyOf`;
            const list = (p as {anyOf: unknown}).anyOf;
            if (!Array.isArray(list) || list.length === 0) {
                throw new Error(`Permission at ${here} must contain at least one entry`);
            }
            list.forEach((c, i) => walk(c, `${here}[${i}]`, depth + 1));
            return;
        }
    }
    throw new Error(`Permission at ${path || "root"} has unknown shape: ${String(p)}`);
}
