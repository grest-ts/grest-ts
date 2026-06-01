import {describe, it, expect} from "vitest";
import type {GGTransportMiddleware} from "@grest-ts/context";
import {FORBIDDEN, GG_ANY_PERMISSION, GG_NO_PERMISSIONS, GGPermission, IsString} from "@grest-ts/schema";
import {GGHttpPermissionsChecker} from "./GGHttpPermissionsChecker";
import {GGWireContextKey} from "./GGWireContextKey";

class TestWire extends GGWireContextKey {
    constructor(name: string, private readonly grants: readonly string[] | null) {
        super(name, IsString.orUndefined);
    }

    public hasPermissions(): boolean {
        return this.grants !== null;
    }

    public async getGrantedPermissions(): Promise<readonly string[]> {
        return this.grants ?? [];
    }
}

const plainMiddleware: GGTransportMiddleware = {};

describe("GGHttpPermissionsChecker", () => {

    describe("constructor / wire selection", () => {
        it("ignores non-wire middlewares and wires without permissions", async () => {
            const checker = new GGHttpPermissionsChecker([
                plainMiddleware,
                new TestWire("ambient", null),
            ]);
            expect(await checker.assert("Api", "method", GG_NO_PERMISSIONS)).toEqual([]);
            await expect(checker.assert("Api", "method", "anything")).rejects.toBeInstanceOf(FORBIDDEN);
        });

        it("collects scopes only from permission-bearing wires", async () => {
            const checker = new GGHttpPermissionsChecker([
                plainMiddleware,
                new TestWire("ambient", null),
                new TestWire("header", ["a", "b"]),
                new TestWire("cookie", ["c"]),
            ]);
            expect(await checker.assert("Api", "method", GG_NO_PERMISSIONS)).toEqual([["a", "b"], ["c"]]);
        });
    });

    describe("assert — no permission wires (fail closed)", () => {
        const checker = new GGHttpPermissionsChecker([]);

        it("passes when nothing is required", async () => {
            expect(await checker.assert("Api", "method", GG_NO_PERMISSIONS)).toEqual([]);
            expect(await checker.assert("Api", "method", undefined as unknown as GGPermission)).toEqual([]);
        });

        it("denies a real or any-permission requirement instead of skipping the check", async () => {
            await expect(checker.assert("Api", "method", "items:read")).rejects.toBeInstanceOf(FORBIDDEN);
            await expect(checker.assert("Api", "method", GG_ANY_PERMISSION)).rejects.toBeInstanceOf(FORBIDDEN);
        });
    });

    describe("assert — with permission wires", () => {
        const checker = new GGHttpPermissionsChecker([new TestWire("header", ["items:read", "items:write"])]);

        it("returns the resolved (frozen) array-of-arrays scopes when satisfied", async () => {
            const scopes = await checker.assert("Api", "method", "items:read");
            expect(scopes).toEqual([["items:read", "items:write"]]);
            expect(Object.isFrozen(scopes)).toBe(true);
        });

        it("passes GG_NO_PERMISSIONS and undefined even when wires are present", async () => {
            expect(await checker.assert("Api", "method", GG_NO_PERMISSIONS)).toEqual([["items:read", "items:write"]]);
            expect(await checker.assert("Api", "method", undefined as unknown as GGPermission)).toEqual([["items:read", "items:write"]]);
        });

        it("throws FORBIDDEN when the required scope is missing", async () => {
            await expect(checker.assert("Api", "method", "admin:all")).rejects.toBeInstanceOf(FORBIDDEN);
        });

        it("unions grants across wires when checking a requirement", async () => {
            const twoWires = new GGHttpPermissionsChecker([
                new TestWire("header", ["a"]),
                new TestWire("cookie", ["b"]),
            ]);
            expect(await twoWires.assert("Api", "method", {allOf: ["a", "b"]})).toEqual([["a"], ["b"]]);
            expect(await twoWires.assert("Api", "method", {anyOf: ["a", "z"]})).toEqual([["a"], ["b"]]);
            await expect(twoWires.assert("Api", "method", "c")).rejects.toBeInstanceOf(FORBIDDEN);
        });
    });

    describe("assertScopes", () => {
        const checker = new GGHttpPermissionsChecker([]);

        it("passes when scopes satisfy the requirement", () => {
            expect(() => checker.assertGrants("Api", "method", [["x"]], "x")).not.toThrow();
        });

        it("throws FORBIDDEN when scopes do not satisfy", () => {
            expect(() => checker.assertGrants("Api", "method", [["x"]], "y")).toThrow(FORBIDDEN);
        });

        it("throws FORBIDDEN when scopes are undefined and a real permission is required", () => {
            expect(() => checker.assertGrants("Api", "method", undefined, "y")).toThrow(FORBIDDEN);
        });

        it("debug message includes schema.method and the described requirement", () => {
            try {
                checker.assertGrants("Api", "method", [["x"]], "y");
                expect.unreachable();
            } catch (e) {
                expect(e).toBeInstanceOf(FORBIDDEN);
                expect((e as InstanceType<typeof FORBIDDEN>).getDebugContext()?.debugMessage).toContain("Api.method requires");
                expect((e as InstanceType<typeof FORBIDDEN>).getDebugContext()?.debugMessage).toContain('"y"');
            }
        });

        it("omits the dot when method is empty (WS connect gate)", () => {
            try {
                checker.assertGrants("Api", "", undefined, "y");
                expect.unreachable();
            } catch (e) {
                expect((e as InstanceType<typeof FORBIDDEN>).getDebugContext()?.debugMessage).toContain("Api requires");
                expect((e as InstanceType<typeof FORBIDDEN>).getDebugContext()?.debugMessage).not.toContain("Api. requires");
            }
        });
    });
});
