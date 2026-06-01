import {describe, expect, it} from "vitest";
import {GG_ANY_PERMISSION, GG_NO_PERMISSIONS} from "./GGPermission";
import {satisfies} from "./satisfies";

const empty: string[][] = [];
const set = (...s: string[]) => [s];

describe("satisfies", () => {

    describe("GG_NO_PERMISSIONS", () => {
        it("passes with empty scope set", () => {
            expect(satisfies(GG_NO_PERMISSIONS, empty)).toBe(true);
        });
        it("passes with any scope set", () => {
            expect(satisfies(GG_NO_PERMISSIONS, set("anything"))).toBe(true);
        });
    });

    describe("GG_ANY_PERMISSION", () => {
        it("rejects empty scope set", () => {
            expect(satisfies(GG_ANY_PERMISSION, empty)).toBe(false);
        });
        it("accepts any non-empty scope set", () => {
            expect(satisfies(GG_ANY_PERMISSION, set("x"))).toBe(true);
            expect(satisfies(GG_ANY_PERMISSION, set("a", "b"))).toBe(true);
        });
    });

    describe("single scope (string)", () => {
        it("matches when present", () => {
            expect(satisfies("items:read", set("items:read", "items:write"))).toBe(true);
        });
        it("does not match when missing", () => {
            expect(satisfies("items:read", set("items:write"))).toBe(false);
        });
        it("does not match empty scope set", () => {
            expect(satisfies("items:read", empty)).toBe(false);
        });
    });

    describe("allOf", () => {
        it("requires all entries present", () => {
            expect(satisfies({allOf: ["a", "b"]}, set("a", "b"))).toBe(true);
            expect(satisfies({allOf: ["a", "b"]}, set("a"))).toBe(false);
            expect(satisfies({allOf: ["a", "b"]}, set("b"))).toBe(false);
            expect(satisfies({allOf: ["a", "b"]}, set("a", "b", "c"))).toBe(true);
        });
        it("single entry behaves like single scope", () => {
            expect(satisfies({allOf: ["a"]}, set("a"))).toBe(true);
            expect(satisfies({allOf: ["a"]}, set("b"))).toBe(false);
        });
    });

    describe("anyOf", () => {
        it("requires at least one entry present", () => {
            expect(satisfies({anyOf: ["a", "b"]}, set("a"))).toBe(true);
            expect(satisfies({anyOf: ["a", "b"]}, set("b"))).toBe(true);
            expect(satisfies({anyOf: ["a", "b"]}, set("c"))).toBe(false);
            expect(satisfies({anyOf: ["a", "b"]}, set("a", "b"))).toBe(true);
        });
        it("single entry behaves like single scope", () => {
            expect(satisfies({anyOf: ["a"]}, set("a"))).toBe(true);
            expect(satisfies({anyOf: ["a"]}, set("b"))).toBe(false);
        });
    });

    describe("nested combinators", () => {
        it("anyOf containing allOf", () => {
            const required = {anyOf: [{allOf: ["a", "b"]}, "c"]} as const;
            expect(satisfies(required, set("c"))).toBe(true);
            expect(satisfies(required, set("a", "b"))).toBe(true);
            expect(satisfies(required, set("a"))).toBe(false);
            expect(satisfies(required, set("a", "b", "c"))).toBe(true);
        });
        it("allOf containing anyOf", () => {
            const required = {allOf: [{anyOf: ["a", "b"]}, "c"]} as const;
            expect(satisfies(required, set("a", "c"))).toBe(true);
            expect(satisfies(required, set("b", "c"))).toBe(true);
            expect(satisfies(required, set("a", "b"))).toBe(false);
            expect(satisfies(required, set("c"))).toBe(false);
        });
        it("nested constants", () => {
            const required = {anyOf: [GG_NO_PERMISSIONS, "a"]} as const;
            expect(satisfies(required, empty)).toBe(true);
            const required2 = {allOf: [GG_ANY_PERMISSION, "a"]} as const;
            expect(satisfies(required2, set("a"))).toBe(true);
            expect(satisfies(required2, empty)).toBe(false);
        });
    });
});
