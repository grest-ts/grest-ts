import {describe, expect, it} from "vitest";
import {validatePermission} from "./validatePermission";
import {GG_ANY_PERMISSION, GG_NO_PERMISSIONS, GGPermission} from "./GGPermission";

describe("validatePermission", () => {

    describe("accepts well-formed trees", () => {
        it("constants", () => {
            expect(() => validatePermission(GG_NO_PERMISSIONS)).not.toThrow();
            expect(() => validatePermission(GG_ANY_PERMISSION)).not.toThrow();
        });
        it("single scope strings", () => {
            expect(() => validatePermission("items:read")).not.toThrow();
        });
        it("allOf and anyOf with entries", () => {
            expect(() => validatePermission({allOf: ["a", "b"]})).not.toThrow();
            expect(() => validatePermission({anyOf: ["a", "b"]})).not.toThrow();
        });
        it("nested up to max depth", () => {
            const deep: GGPermission = {anyOf: [{allOf: [{anyOf: ["a", "b"]}, "c"]}, "d"]};
            expect(() => validatePermission(deep)).not.toThrow();
        });
    });

    describe("rejects malformed trees", () => {
        it("empty string scope", () => {
            expect(() => validatePermission("" as any)).toThrow(/non-empty/);
        });
        it("empty allOf array", () => {
            expect(() => validatePermission({allOf: []} as any)).toThrow(/at least one/);
        });
        it("empty anyOf array", () => {
            expect(() => validatePermission({anyOf: []} as any)).toThrow(/at least one/);
        });
        it("non-array allOf payload", () => {
            expect(() => validatePermission({allOf: "nope"} as any)).toThrow(/at least one/);
        });
        it("depth exceeding MAX_DEPTH", () => {
            const tooDeep: any = {anyOf: [{allOf: [{anyOf: [{allOf: [{anyOf: ["a"]}]}]}]}]};
            expect(() => validatePermission(tooDeep)).toThrow(/too deep/);
        });
        it("unknown object shape", () => {
            expect(() => validatePermission({weird: "thing"} as any)).toThrow(/unknown shape/);
        });
        it("null", () => {
            expect(() => validatePermission(null as any)).toThrow(/unknown shape/);
        });
        it("number", () => {
            expect(() => validatePermission(42 as any)).toThrow(/unknown shape/);
        });
    });

    describe("error path includes location", () => {
        it("names the offending sub-path", () => {
            expect(() => validatePermission({anyOf: ["a", {allOf: []}]} as any))
                .toThrow(/anyOf\[1\]\.allOf/);
        });
    });
});
