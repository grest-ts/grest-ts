import type {GGPermission} from "@grest-ts/schema";
import {GG_ANY_PERMISSION, GG_NO_PERMISSIONS} from "@grest-ts/schema";
import type {OpenAPIV3_1} from "openapi-types";

export const DEFAULT_BEARER_SCHEME = "BearerAuth";

/**
 * Map a GGPermission tree to OpenAPI/AsyncAPI `security` requirements.
 * Both spec families use the same security-requirement shape, so this helper
 * is shared between `@grest-ts/openapi` and `@grest-ts/asyncapi`.
 *
 * Returns `null` when the permission is `undefined` (caller should not modify
 * operation.security in that case).
 *
 * Mapping:
 *  - GG_NO_PERMISSIONS → `[]` (explicit "no security" per OpenAPI spec)
 *  - GG_ANY_PERMISSION → `[{BearerAuth: []}]`
 *  - bare string       → `[{BearerAuth: [scope]}]`
 *  - allOf(a, b)       → `[{BearerAuth: [a, b]}]`
 *  - anyOf(a, b)       → `[{BearerAuth: [a]}, {BearerAuth: [b]}]`
 *  - Nested            → flattened to disjunctive normal form.
 *
 * Registers the BearerAuth scheme into the supplied map if any non-empty
 * mapping is emitted.
 */
export function permissionToSecurity(
    permission: GGPermission,
    securitySchemes: Map<string, OpenAPIV3_1.SecuritySchemeObject>
): OpenAPIV3_1.SecurityRequirementObject[] | null {
    if (permission === GG_NO_PERMISSIONS) return [];
    if (permission === GG_ANY_PERMISSION) {
        registerBearerAuth(securitySchemes);
        return [{[DEFAULT_BEARER_SCHEME]: []}];
    }
    const dnf = toDNF(permission);
    if (dnf.length === 0) return [];
    registerBearerAuth(securitySchemes);
    return dnf.map(scopes => ({[DEFAULT_BEARER_SCHEME]: scopes}));
}

function toDNF(p: GGPermission): string[][] {
    if (typeof p === "string") return [[p]];
    if (typeof p === "symbol") return [];
    if ("allOf" in p) {
        let result: string[][] = [[]];
        for (const child of p.allOf) {
            const childDnf = toDNF(child);
            if (childDnf.length === 0) continue;
            const next: string[][] = [];
            for (const acc of result) {
                for (const childAlt of childDnf) {
                    next.push([...acc, ...childAlt]);
                }
            }
            result = next;
        }
        return result.map(dedup);
    }
    if ("anyOf" in p) {
        const result: string[][] = [];
        for (const child of p.anyOf) {
            for (const childAlt of toDNF(child)) result.push(childAlt);
        }
        return result.map(dedup);
    }
    return [];
}

function dedup(scopes: string[]): string[] {
    return Array.from(new Set(scopes));
}

export function registerBearerAuth(
    securitySchemes: Map<string, OpenAPIV3_1.SecuritySchemeObject>
): void {
    if (!securitySchemes.has(DEFAULT_BEARER_SCHEME)) {
        securitySchemes.set(DEFAULT_BEARER_SCHEME, {
            type: "http",
            scheme: "bearer",
            description: "Bearer token. Scopes listed per operation are required to invoke that operation.",
        });
    }
}
