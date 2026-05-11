import {describe, expect, it} from "vitest";
import {
    FORBIDDEN,
    GG_ANY_PERMISSION,
    GG_NO_PERMISSIONS,
    GGContractClass,
    IsString,
    NOT_AUTHORIZED,
    SERVER_ERROR,
} from "@grest-ts/schema";
import {GGRpc, httpSchema} from "@grest-ts/http";
import {toOpenApi} from "../src/toOpenApi";

function makeApi(name: string, methodName: string, permission: any) {
    const contract = new GGContractClass(name, {
        [methodName]: {
            success: IsString,
            errors: permission === GG_NO_PERMISSIONS ? [SERVER_ERROR] : [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
            permission,
        },
    });
    return httpSchema(contract as any).pathPrefix(name.toLowerCase()).routes({
        [methodName]: GGRpc.GET(methodName),
    });
}

function opSecurity(doc: any, methodName: string): any {
    for (const path in doc.paths) {
        const item = doc.paths[path];
        for (const method of ["get", "post", "put", "delete", "patch"]) {
            if (item?.[method] && item[method].operationId?.includes(methodName)) {
                return item[method].security;
            }
        }
    }
    // Fallback: just grab the first operation's security if only one exists.
    const firstPath = Object.values(doc.paths)[0] as any;
    const firstOp = firstPath && (Object.values(firstPath)[0] as any);
    return firstOp?.security;
}

describe("toOpenApi — permission → security mapping", () => {

    it("GG_NO_PERMISSIONS → explicit empty security (overrides default)", () => {
        const api = makeApi("PubApi", "ping", GG_NO_PERMISSIONS);
        const doc = toOpenApi([api]);
        expect(opSecurity(doc, "ping")).toEqual([]);
        // No BearerAuth scheme should be emitted unless something else uses it.
        expect(doc.components?.securitySchemes?.BearerAuth).toBeUndefined();
    });

    it("GG_ANY_PERMISSION → bearerAuth requirement with empty scope list", () => {
        const api = makeApi("AnyApi", "anyAuth", GG_ANY_PERMISSION);
        const doc = toOpenApi([api]);
        expect(opSecurity(doc, "anyAuth")).toEqual([{BearerAuth: []}]);
        expect(doc.components?.securitySchemes?.BearerAuth).toMatchObject({type: "http", scheme: "bearer"});
    });

    it("bare string scope → bearerAuth with single scope", () => {
        const api = makeApi("ScopeApi", "read", "items:read");
        const doc = toOpenApi([api]);
        expect(opSecurity(doc, "read")).toEqual([{BearerAuth: ["items:read"]}]);
    });

    it("allOf → single requirement with multiple scopes (AND)", () => {
        const api = makeApi("AllApi", "rw", {allOf: ["items:read", "items:write"]});
        const doc = toOpenApi([api]);
        expect(opSecurity(doc, "rw")).toEqual([{BearerAuth: ["items:read", "items:write"]}]);
    });

    it("anyOf → multiple requirements (OR)", () => {
        const api = makeApi("AnyOfApi", "x", {anyOf: ["a", "b"]});
        const doc = toOpenApi([api]);
        expect(opSecurity(doc, "x")).toEqual([
            {BearerAuth: ["a"]},
            {BearerAuth: ["b"]},
        ]);
    });

    it("anyOf(allOf, scope) → DNF flatten", () => {
        const api = makeApi("DnfApi", "x", {anyOf: [{allOf: ["a", "b"]}, "c"]});
        const doc = toOpenApi([api]);
        expect(opSecurity(doc, "x")).toEqual([
            {BearerAuth: ["a", "b"]},
            {BearerAuth: ["c"]},
        ]);
    });

    it("allOf(anyOf(a,b), c) → DNF cartesian flatten", () => {
        const api = makeApi("CartesianApi", "x", {allOf: [{anyOf: ["a", "b"]}, "c"]});
        const doc = toOpenApi([api]);
        expect(opSecurity(doc, "x")).toEqual([
            {BearerAuth: ["a", "c"]},
            {BearerAuth: ["b", "c"]},
        ]);
    });

    it("nested anyOf collapses without duplication", () => {
        const api = makeApi("NestedApi", "x", {anyOf: ["a", {anyOf: ["b", "c"]}]});
        const doc = toOpenApi([api]);
        expect(opSecurity(doc, "x")).toEqual([
            {BearerAuth: ["a"]},
            {BearerAuth: ["b"]},
            {BearerAuth: ["c"]},
        ]);
    });

    it("repeated scopes inside one AND group are deduped", () => {
        const api = makeApi("DedupApi", "x", {allOf: [{anyOf: ["a", "a"]}, "a"]});
        const doc = toOpenApi([api]);
        // After cartesian product: [["a","a"], ["a","a"]] → dedup'd to [["a"],["a"]].
        const sec = opSecurity(doc, "x");
        expect(sec).toEqual([{BearerAuth: ["a"]}, {BearerAuth: ["a"]}]);
    });
});
