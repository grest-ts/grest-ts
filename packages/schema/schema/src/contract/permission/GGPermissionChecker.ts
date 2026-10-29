import {GG_ANY_PERMISSION, GG_NO_PERMISSIONS, GGPermission} from "./GGPermission";
import {GGRequirement, GGRequirementByField, GGRequirementResource, isRequirement, isRequirementByField, requirementField} from "./GGRequirement";
import {NOT_FOUND} from "../standardErrors";

const MAX_DEPTH = 3;

export class GGPermissionChecker {

    /** A requirement never passes here: it needs an authority. Check `scopesOf(permission)` and run the requirements through the authority. */
    public static satisfies(required: GGPermission, granted: undefined | ReadonlyArray<ReadonlyArray<string>>): boolean {
        if (required === GG_NO_PERMISSIONS || required === undefined) return true
        if (required === GG_ANY_PERMISSION) return granted !== undefined && granted.length > 0
        if (typeof required === "string") {
            if (granted === undefined || granted.length === 0) return false;
            for (let i = 0; i < granted.length; i++) {
                if (granted[i].indexOf(required) >= 0) {
                    return true;
                }
            }
            return false
        }
        if (required && typeof required === "object") {
            if ("allOf" in required) return required.allOf.every(p => this.satisfies(p, granted))
            if ("anyOf" in required) return required.anyOf.some(p => this.satisfies(p, granted))
        }
        return false
    }

    /** The requirements and byFields in a permission: itself, or the members of an `allOf` (they can't sit in `anyOf`). */
    public static entriesOf(p: GGPermission | undefined): (GGRequirement | GGRequirementByField)[] {
        if (isRequirement(p) || isRequirementByField(p)) return [p]
        if (p && typeof p === "object" && "allOf" in p) return p.allOf.flatMap(c => this.entriesOf(c))
        return []
    }

    /** Every requirement a permission may check, with each case of a `byField`. */
    public static requirementsOf(p: GGPermission | undefined): GGRequirement[] {
        return this.entriesOf(p).flatMap(e => isRequirement(e) ? [e] : Object.values(e.cases).filter(c => c !== null))
    }

    /** The requirements a request with this validated input must pass: only the case of each `byField` it takes. */
    public static requirementsFor(p: GGPermission | undefined, input: unknown): GGRequirement[] {
        return this.entriesOf(p).flatMap(e => {
            if (isRequirement(e)) return [e]
            const value = requirementField(input, e.field)
            if (typeof value !== "string" || !Object.hasOwn(e.cases, value)) throw new Error(`No case for input.${e.field} ${JSON.stringify(value)}`)
            const picked = e.cases[value]
            return picked ? [picked] : []
        })
    }

    /** A permission without its requirements: what the caller's granted scopes must satisfy. */
    public static scopesOf(p: GGPermission): GGPermission {
        if (isRequirement(p) || isRequirementByField(p)) return GG_NO_PERMISSIONS
        if (p && typeof p === "object" && "allOf" in p) {
            const rest = p.allOf.map(c => this.scopesOf(c)).filter(c => c !== GG_NO_PERMISSIONS)
            return rest.length ? {allOf: rest as [GGPermission, ...GGPermission[]]} : GG_NO_PERMISSIONS
        }
        return p
    }

    public static describePermission(p: GGPermission | undefined): string {
        if (p === undefined) return "undefined";
        if (p === GG_NO_PERMISSIONS) return "GG_NO_PERMISSIONS";
        if (p === GG_ANY_PERMISSION) return "GG_ANY_PERMISSION";
        if (typeof p === "string") return JSON.stringify(p);
        if (isRequirement(p)) return describeRequirement(p);
        if (isRequirementByField(p)) return describeByField(p);
        if ("allOf" in p) return `allOf(${p.allOf.map(c => this.describePermission(c)).join(", ")})`;
        if ("anyOf" in p) return `anyOf(${p.anyOf.map(c => this.describePermission(c)).join(", ")})`;
        return String(p);
    }

    public static validatePermission(permission: GGPermission, path: string = ""): void {
        this._walk(permission, path, 0, false);
    }

    private static _walk(p: unknown, path: string, depth: number, inAnyOf: boolean): void {
        if (depth > MAX_DEPTH) {
            throw new Error(`Permission tree too deep at ${path || "root"}: max depth is ${MAX_DEPTH}`);
        }
        if (p === GG_NO_PERMISSIONS || p === GG_ANY_PERMISSION) return;
        if (isRequirement(p)) {
            if (inAnyOf) throw new Error(`Permission at ${path || "root"}: a requirement can't sit inside anyOf`);
            validateRequirement(p, path || "root");
            return;
        }
        if (isRequirementByField(p)) {
            if (inAnyOf) throw new Error(`Permission at ${path || "root"}: a byField can't sit inside anyOf`);
            validateByField(p, path || "root");
            return;
        }
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
                list.forEach((c, i) => this._walk(c, `${here}[${i}]`, depth + 1, inAnyOf));
                return;
            }
            if ("anyOf" in p) {
                const here = `${path}.anyOf`;
                const list = (p as { anyOf: unknown }).anyOf;
                if (!Array.isArray(list) || list.length === 0) {
                    throw new Error(`Permission at ${here} must contain at least one entry`);
                }
                list.forEach((c, i) => this._walk(c, `${here}[${i}]`, depth + 1, true));
                return;
            }
        }
        throw new Error(`Permission at ${path || "root"} has unknown shape: ${String(p)}`);
    }


}

function describeResource(r: GGRequirementResource): string {
    const id = r.id === undefined ? "" : "field" in r.id ? ` from input.${r.id.field}` : ` from context ${r.id.context}`
    return `${r.type}${id}`
}

function describeRequirement(r: GGRequirement): string {
    if (r.list) return `${r.action} (lists what the caller may see)`
    const on = `${r.action} on ${describeResource(r.resource!)}`
    return [on, r.createOn ? `, or on ${describeResource(r.createOn)} when creating` : "", r.hidden ? " (denied as NOT_FOUND)" : ""].join("")
}

function describeByField(p: GGRequirementByField): string {
    return `by input.${p.field}: ${Object.entries(p.cases).map(([k, c]) => `${k} → ${c ? describeRequirement(c) : "nothing more"}`).join("; ")}`
}

function validateResource(r: unknown, path: string): void {
    const res = r as GGRequirementResource
    if (typeof res !== "object" || res === null || typeof res.type !== "string" || res.type.length === 0) {
        throw new Error(`Requirement at ${path} needs a resource type`)
    }
    const id = res.id as unknown
    if (id === undefined) return
    const ok = typeof id === "object" && id !== null && (
        ("field" in id && typeof id.field === "string" && id.field.length > 0) ||
        ("context" in id && typeof id.context === "string" && id.context.length > 0))
    if (!ok) throw new Error(`Requirement at ${path} has an id that is neither {field} nor {context}`)
}

function validateRequirement(r: GGRequirement, path: string): void {
    if (typeof r.action !== "string" || r.action.length === 0) throw new Error(`Requirement at ${path} needs an action`)
    if (!Array.isArray(r.errors)) throw new Error(`Requirement at ${path} needs its errors`)
    if (r.hidden && !r.errors.includes(NOT_FOUND)) throw new Error(`Requirement at ${path} is hidden, so its errors must include NOT_FOUND`)
    if (r.list) {
        if (r.resource || r.createOn) throw new Error(`Requirement at ${path} is a list: it names no resource`)
        return
    }
    validateResource(r.resource, `${path}.resource`)
    if (r.createOn) {
        validateResource(r.createOn, `${path}.createOn`)
        if (!r.resource?.id || !("field" in r.resource.id)) throw new Error(`Requirement at ${path} has createOn, so its resource id must be an input field`)
    }
}

function validateByField(p: GGRequirementByField, path: string): void {
    if (typeof p.field !== "string" || p.field.length === 0) throw new Error(`byField at ${path} needs a field`)
    const cases = Object.entries(p.cases ?? {})
    if (!cases.length) throw new Error(`byField at ${path} needs at least one case`)
    for (const [k, c] of cases) {
        if (c === null) continue
        if (!isRequirement(c)) throw new Error(`byField at ${path}: case ${k} is neither a requirement nor null`)
        validateRequirement(c, `${path}.cases.${k}`)
    }
}
