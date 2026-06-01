import {callOn, GGTest} from "@grest-ts/testkit"
import {GGContext} from "@grest-ts/context"
import {afterEach} from "vitest"
import {MainRuntime} from "../src/main"
import {AppPermission, PermissionsApi, TEST_RESOLVER_THROW_SCOPE, TEST_SCOPES_WIRE} from "../src/api/PermissionsApi"

/**
 * Helper: create a request scope carrying the given scopes on the credential wire.
 * The wire emits them as the x-test-scopes header; the server's process() verifies
 * identity and permissions() yields them to the gate — the real transport path.
 */
function withScopes(...scopes: string[]): GGContext {
    const scope = new GGContext("permissions-test")
    scope.set(TEST_SCOPES_WIRE, scopes.join(","))
    return scope
}

describe.shuffle("permissions / HTTP gate", () => {

    GGTest.startInline(MainRuntime)

    let scope: GGContext | undefined
    afterEach(() => {
        scope?.reset()
        scope = undefined
    })

    describe("GG_ANY_PERMISSION", () => {
        test("no identity → NOT_AUTHORIZED", async () => {
            await expect(callOn(PermissionsApi).anyAuth()).rejects.toThrow(/NOT_AUTHORIZED/)
        })
        test("identity with any scope passes", async () => {
            scope = withScopes("anything")
            expect(await callOn(PermissionsApi, scope).anyAuth()).toBe("ok")
        })
    })

    describe("single-scope permission", () => {
        test("no identity → NOT_AUTHORIZED", async () => {
            await expect(callOn(PermissionsApi).needsRead()).rejects.toThrow(/NOT_AUTHORIZED/)
        })
        test("identity with matching scope passes", async () => {
            scope = withScopes(AppPermission.Read)
            expect(await callOn(PermissionsApi, scope).needsRead()).toBe("ok")
        })
        test("identity without the scope → FORBIDDEN", async () => {
            scope = withScopes(AppPermission.Admin)
            await expect(callOn(PermissionsApi, scope).needsRead()).rejects.toThrow(/FORBIDDEN/)
        })
    })

    describe("allOf combinator", () => {
        test("both scopes present → passes", async () => {
            scope = withScopes(AppPermission.Read, AppPermission.Write)
            expect(await callOn(PermissionsApi, scope).needsReadAndWrite()).toBe("ok")
        })
        test("only one of two scopes → FORBIDDEN", async () => {
            scope = withScopes(AppPermission.Read)
            await expect(callOn(PermissionsApi, scope).needsReadAndWrite()).rejects.toThrow(/FORBIDDEN/)
        })
        test("extra unrelated scopes are fine", async () => {
            scope = withScopes(AppPermission.Read, AppPermission.Write, AppPermission.Admin)
            expect(await callOn(PermissionsApi, scope).needsReadAndWrite()).toBe("ok")
        })
    })

    describe("anyOf combinator", () => {
        test("first scope present → passes", async () => {
            scope = withScopes(AppPermission.Read)
            expect(await callOn(PermissionsApi, scope).needsReadOrAdmin()).toBe("ok")
        })
        test("second scope present → passes", async () => {
            scope = withScopes(AppPermission.Admin)
            expect(await callOn(PermissionsApi, scope).needsReadOrAdmin()).toBe("ok")
        })
        test("unrelated scope → FORBIDDEN", async () => {
            scope = withScopes(AppPermission.Write)
            await expect(callOn(PermissionsApi, scope).needsReadOrAdmin()).rejects.toThrow(/FORBIDDEN/)
        })
    })

    describe("nested combinator anyOf(allOf, scope)", () => {
        test("matches inner allOf branch", async () => {
            scope = withScopes(AppPermission.Read, AppPermission.Write)
            expect(await callOn(PermissionsApi, scope).nested()).toBe("ok")
        })
        test("matches single-scope branch", async () => {
            scope = withScopes(AppPermission.Admin)
            expect(await callOn(PermissionsApi, scope).nested()).toBe("ok")
        })
        test("partial allOf does not match", async () => {
            scope = withScopes(AppPermission.Read)
            await expect(callOn(PermissionsApi, scope).nested()).rejects.toThrow(/FORBIDDEN/)
        })
    })

    describe("GG_PERMISSIONS visible in handler for sub-checks", () => {
        test("admin scope → admin branch", async () => {
            scope = withScopes(AppPermission.Admin)
            const out = await callOn(PermissionsApi, scope).checksInside({label: "x"})
            expect(out).toEqual({label: "x", branch: "admin"})
        })
        test("owner scope → owner branch", async () => {
            scope = withScopes(AppPermission.Owner)
            const out = await callOn(PermissionsApi, scope).checksInside({label: "y"})
            expect(out).toEqual({label: "y", branch: "owner"})
        })
        test("neither scope → gate FORBIDDEN, handler never runs", async () => {
            scope = withScopes(AppPermission.Read)
            await expect(callOn(PermissionsApi, scope).checksInside({label: "z"})).rejects.toThrow(/FORBIDDEN/)
        })
    })

    describe("order semantics", () => {
        test("no wire → no identity → NOT_AUTHORIZED on a gated method", async () => {
            // Omitting the wire leaves x-test-scopes unset, so the wire's process()
            // throws NOT_AUTHORIZED before any permission check runs.
            await expect(callOn(PermissionsApi).needsRead()).rejects.toThrow(/NOT_AUTHORIZED/)
        })
    })

    describe("resolver crashes", () => {
        test("permissions() throws → SERVER_ERROR to caller (handler not invoked)", async () => {
            // Sentinel scope makes the wire's permissions() throw an unrelated Error.
            // The gate's outer catch converts it to SERVER_ERROR via ERROR.fromUnknown.
            scope = withScopes(TEST_RESOLVER_THROW_SCOPE)
            await expect(callOn(PermissionsApi, scope).needsRead()).rejects.toThrow(/SERVER_ERROR/)
        })
    })
})
