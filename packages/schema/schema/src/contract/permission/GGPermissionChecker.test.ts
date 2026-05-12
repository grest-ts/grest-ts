import {describe, expect, it} from "vitest";
import {GGPermissionChecker} from "./GGPermissionChecker";
import {GG_ANY_PERMISSION, GG_NO_PERMISSIONS} from "./GGPermission";

describe("GGPermissionChecker", () => {

    it("exposes the scope set", () => {
        const scopes = new Set(["a", "b"]);
        const checker = new GGPermissionChecker(scopes);
        expect(checker.scopes).toBe(scopes);
    });

    it("is frozen", () => {
        const checker = new GGPermissionChecker(new Set(["a"]));
        expect(Object.isFrozen(checker)).toBe(true);
    });

    it("delegates has() to satisfies()", () => {
        const checker = new GGPermissionChecker(new Set(["items:read", "items:write"]));
        expect(checker.has("items:read")).toBe(true);
        expect(checker.has("items:delete")).toBe(false);
        expect(checker.has({allOf: ["items:read", "items:write"]})).toBe(true);
        expect(checker.has({allOf: ["items:read", "items:delete"]})).toBe(false);
        expect(checker.has({anyOf: ["items:delete", "items:read"]})).toBe(true);
        expect(checker.has(GG_NO_PERMISSIONS)).toBe(true);
        expect(checker.has(GG_ANY_PERMISSION)).toBe(true);
    });

    it("empty scope set rejects GG_ANY_PERMISSION", () => {
        const checker = new GGPermissionChecker(new Set());
        expect(checker.has(GG_ANY_PERMISSION)).toBe(false);
        expect(checker.has(GG_NO_PERMISSIONS)).toBe(true);
        expect(checker.has("anything")).toBe(false);
    });
});
