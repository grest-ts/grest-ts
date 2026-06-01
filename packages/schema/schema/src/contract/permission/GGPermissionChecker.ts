import {GG_ANY_PERMISSION, GG_NO_PERMISSIONS, GGPermission} from "./GGPermission";

const MAX_DEPTH = 3;

export class GGPermissionChecker {

    public static satisfies(required: GGPermission, scopes: undefined | ReadonlyArray<ReadonlyArray<string>>): boolean {
        if (required === GG_NO_PERMISSIONS || required === undefined) return true
        if (required === GG_ANY_PERMISSION) return scopes?.length > 0
        if (typeof required === "string") {
            if (scopes === undefined || scopes.length === 0) return false;
            for (let i = 0; i < scopes.length; i++) {
                if (scopes[i].indexOf(required) >= 0) {
                    return true;
                }
            }
            return false
        }
        if (required && typeof required === "object") {
            if ("allOf" in required) return required.allOf.every(p => this.satisfies(p, scopes))
            if ("anyOf" in required) return required.anyOf.some(p => this.satisfies(p, scopes))
        }
        return false
    }

    public static describePermission(p: GGPermission | undefined): string {
        if (p === undefined) return "undefined";
        if (p === GG_NO_PERMISSIONS) return "GG_NO_PERMISSIONS";
        if (p === GG_ANY_PERMISSION) return "GG_ANY_PERMISSION";
        if (typeof p === "string") return JSON.stringify(p);
        if ("allOf" in p) return `allOf(${p.allOf.map(c => this.describePermission(c)).join(", ")})`;
        if ("anyOf" in p) return `anyOf(${p.anyOf.map(c => this.describePermission(c)).join(", ")})`;
        return String(p);
    }

    public static validatePermission(permission: GGPermission, path: string = ""): void {
        this._walk(permission, path, 0);
    }

    private static _walk(p: unknown, path: string, depth: number): void {
        if (depth > MAX_DEPTH) {
            throw new Error(`Permission tree too deep at ${path || "root"}: max depth is ${MAX_DEPTH}`);
        }
        if (p === GG_NO_PERMISSIONS || p === GG_ANY_PERMISSION) return;
        if (typeof p === "string") {
            if (p.length === 0) throw new Error(`Permission scope at ${path || "root"} must be a non-empty string`);
            return;
        }
        if (p !== null && typeof p === "object") {
            if ("allOf" in p) {
                const here = `${path}.allOf`;
                const list = (p as { allOf: unknown }).allOf;
                if (!Array.isArray(list) || list.length === 0) {
                    throw new Error(`Permission at ${here} must contain at least one entry`);
                }
                list.forEach((c, i) => this._walk(c, `${here}[${i}]`, depth + 1));
                return;
            }
            if ("anyOf" in p) {
                const here = `${path}.anyOf`;
                const list = (p as { anyOf: unknown }).anyOf;
                if (!Array.isArray(list) || list.length === 0) {
                    throw new Error(`Permission at ${here} must contain at least one entry`);
                }
                list.forEach((c, i) => this._walk(c, `${here}[${i}]`, depth + 1));
                return;
            }
        }
        throw new Error(`Permission at ${path || "root"} has unknown shape: ${String(p)}`);
    }


}
