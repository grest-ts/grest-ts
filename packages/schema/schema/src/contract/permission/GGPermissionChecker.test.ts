import {describe, expect, it} from "vitest";
import {GG_ANY_PERMISSION, GG_NO_PERMISSIONS, GGPermission} from "./GGPermission";
import {GGPermissionChecker} from "./GGPermissionChecker";

const empty: string[][] = [];
const set = (...s: string[]) => [s];

describe("GGPermissionChecker.satisfies", () => {

    describe("GG_NO_PERMISSIONS", () => {
        it("passes with empty scope set", () => {
            expect(GGPermissionChecker.satisfies(GG_NO_PERMISSIONS, empty)).toBe(true);
        });
        it("passes with any scope set", () => {
            expect(GGPermissionChecker.satisfies(GG_NO_PERMISSIONS, set("anything"))).toBe(true);
        });
    });

    describe("GG_ANY_PERMISSION", () => {
        it("rejects empty scope set", () => {
            expect(GGPermissionChecker.satisfies(GG_ANY_PERMISSION, empty)).toBe(false);
        });
        it("accepts any non-empty scope set", () => {
            expect(GGPermissionChecker.satisfies(GG_ANY_PERMISSION, set("x"))).toBe(true);
            expect(GGPermissionChecker.satisfies(GG_ANY_PERMISSION, set("a", "b"))).toBe(true);
        });
    });

    describe("single scope (string)", () => {
        it("matches when present", () => {
            expect(GGPermissionChecker.satisfies("items:read", set("items:read", "items:write"))).toBe(true);
        });
        it("does not match when missing", () => {
            expect(GGPermissionChecker.satisfies("items:read", set("items:write"))).toBe(false);
        });
        it("does not match empty scope set", () => {
            expect(GGPermissionChecker.satisfies("items:read", empty)).toBe(false);
        });
    });

    describe("allOf", () => {
        it("requires all entries present", () => {
            expect(GGPermissionChecker.satisfies({allOf: ["a", "b"]}, set("a", "b"))).toBe(true);
            expect(GGPermissionChecker.satisfies({allOf: ["a", "b"]}, set("a"))).toBe(false);
            expect(GGPermissionChecker.satisfies({allOf: ["a", "b"]}, set("b"))).toBe(false);
            expect(GGPermissionChecker.satisfies({allOf: ["a", "b"]}, set("a", "b", "c"))).toBe(true);
        });
        it("single entry behaves like single scope", () => {
            expect(GGPermissionChecker.satisfies({allOf: ["a"]}, set("a"))).toBe(true);
            expect(GGPermissionChecker.satisfies({allOf: ["a"]}, set("b"))).toBe(false);
        });
    });

    describe("anyOf", () => {
        it("requires at least one entry present", () => {
            expect(GGPermissionChecker.satisfies({anyOf: ["a", "b"]}, set("a"))).toBe(true);
            expect(GGPermissionChecker.satisfies({anyOf: ["a", "b"]}, set("b"))).toBe(true);
            expect(GGPermissionChecker.satisfies({anyOf: ["a", "b"]}, set("c"))).toBe(false);
            expect(GGPermissionChecker.satisfies({anyOf: ["a", "b"]}, set("a", "b"))).toBe(true);
        });
        it("single entry behaves like single scope", () => {
            expect(GGPermissionChecker.satisfies({anyOf: ["a"]}, set("a"))).toBe(true);
            expect(GGPermissionChecker.satisfies({anyOf: ["a"]}, set("b"))).toBe(false);
        });
    });

    describe("nested combinators", () => {
        it("anyOf containing allOf", () => {
            const required = {anyOf: [{allOf: ["a", "b"]}, "c"]} as const;
            expect(GGPermissionChecker.satisfies(required, set("c"))).toBe(true);
            expect(GGPermissionChecker.satisfies(required, set("a", "b"))).toBe(true);
            expect(GGPermissionChecker.satisfies(required, set("a"))).toBe(false);
            expect(GGPermissionChecker.satisfies(required, set("a", "b", "c"))).toBe(true);
        });
        it("allOf containing anyOf", () => {
            const required = {allOf: [{anyOf: ["a", "b"]}, "c"]} as const;
            expect(GGPermissionChecker.satisfies(required, set("a", "c"))).toBe(true);
            expect(GGPermissionChecker.satisfies(required, set("b", "c"))).toBe(true);
            expect(GGPermissionChecker.satisfies(required, set("a", "b"))).toBe(false);
            expect(GGPermissionChecker.satisfies(required, set("c"))).toBe(false);
        });
        it("nested constants", () => {
            const required = {anyOf: [GG_NO_PERMISSIONS, "a"]} as const;
            expect(GGPermissionChecker.satisfies(required, empty)).toBe(true);
            const required2 = {allOf: [GG_ANY_PERMISSION, "a"]} as const;
            expect(GGPermissionChecker.satisfies(required2, set("a"))).toBe(true);
            expect(GGPermissionChecker.satisfies(required2, empty)).toBe(false);
        });
    });
});

describe("GGPermissionChecker.describePermission", () => {
    it("describes constants, strings, and flat combinators", () => {
        expect(GGPermissionChecker.describePermission(GG_NO_PERMISSIONS)).toBe("GG_NO_PERMISSIONS");
        expect(GGPermissionChecker.describePermission(GG_ANY_PERMISSION)).toBe("GG_ANY_PERMISSION");
        expect(GGPermissionChecker.describePermission("items:read")).toBe('"items:read"');
        expect(GGPermissionChecker.describePermission({allOf: ["a", "b"]})).toBe('allOf("a", "b")');
        expect(GGPermissionChecker.describePermission({anyOf: ["a", "b"]})).toBe('anyOf("a", "b")');
    });

    it("recurses into nested combinators without losing `this`", () => {
        const nested: GGPermission = {anyOf: [{allOf: ["a", "b"]}, "c"]};
        expect(GGPermissionChecker.describePermission(nested)).toBe('anyOf(allOf("a", "b"), "c")');
    });
});

describe("GGPermissionChecker.validatePermission", () => {

    describe("accepts well-formed trees", () => {
        it("constants", () => {
            expect(() => GGPermissionChecker.validatePermission(GG_NO_PERMISSIONS)).not.toThrow();
            expect(() => GGPermissionChecker.validatePermission(GG_ANY_PERMISSION)).not.toThrow();
        });
        it("single scope strings", () => {
            expect(() => GGPermissionChecker.validatePermission("items:read")).not.toThrow();
        });
        it("allOf and anyOf with entries", () => {
            expect(() => GGPermissionChecker.validatePermission({allOf: ["a", "b"]})).not.toThrow();
            expect(() => GGPermissionChecker.validatePermission({anyOf: ["a", "b"]})).not.toThrow();
        });
        it("nested up to max depth", () => {
            const deep: GGPermission = {anyOf: [{allOf: [{anyOf: ["a", "b"]}, "c"]}, "d"]};
            expect(() => GGPermissionChecker.validatePermission(deep)).not.toThrow();
        });
    });

    describe("rejects malformed trees", () => {
        it("empty string scope", () => {
            expect(() => GGPermissionChecker.validatePermission("" as any)).toThrow(/non-empty/);
        });
        it("empty allOf array", () => {
            expect(() => GGPermissionChecker.validatePermission({allOf: []} as any)).toThrow(/at least one/);
        });
        it("empty anyOf array", () => {
            expect(() => GGPermissionChecker.validatePermission({anyOf: []} as any)).toThrow(/at least one/);
        });
        it("non-array allOf payload", () => {
            expect(() => GGPermissionChecker.validatePermission({allOf: "nope"} as any)).toThrow(/at least one/);
        });
        it("depth exceeding MAX_DEPTH", () => {
            const tooDeep: any = {anyOf: [{allOf: [{anyOf: [{allOf: [{anyOf: ["a"]}]}]}]}]};
            expect(() => GGPermissionChecker.validatePermission(tooDeep)).toThrow(/too deep/);
        });
        it("unknown object shape", () => {
            expect(() => GGPermissionChecker.validatePermission({weird: "thing"} as any)).toThrow(/unknown shape/);
        });
        it("null", () => {
            expect(() => GGPermissionChecker.validatePermission(null as any)).toThrow(/unknown shape/);
        });
        it("number", () => {
            expect(() => GGPermissionChecker.validatePermission(42 as any)).toThrow(/unknown shape/);
        });
    });

    describe("error path includes location", () => {
        it("names the offending sub-path", () => {
            expect(() => GGPermissionChecker.validatePermission({anyOf: ["a", {allOf: []}]} as any))
                .toThrow(/anyOf\[1\]\.allOf/);
        });
    });
});
