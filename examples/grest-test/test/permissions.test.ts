import {callOn, GGTest} from "@grest-ts/testkit"
import {GGContext} from "@grest-ts/context"
import {afterEach} from "vitest"
import {MainRuntime} from "../src/main"
import {AppPermission, GG_TEST_SCOPES, PermissionsApi, TEST_RESOLVER_THROW_SCOPE} from "../src/api/PermissionsApi"

/**
 * Helper: create a request scope with the given scopes set.
 * The test middleware reads GG_TEST_SCOPES from context and writes a header
 * the server-side middleware parses back into context — exercising the real
 * transport path including the gate.
 */
function withScopes(...scopes: string[]): GGContext {
    const scope = new GGContext("permissions-test")
    scope.set(GG_TEST_SCOPES, scopes)
    return scope
}

describe.shuffle("permissions / HTTP gate", () => {

    GGTest.startInline(MainRuntime)

    let scope: GGContext | undefined
    afterEach(() => {
        scope?.reset()
        scope = undefined
    })

    describe("GG_NO_PERMISSIONS (public)", () => {
        test("works with no caller identity", async () => {
            const client = callOn(PermissionsApi)
            expect(await client.publicMethod()).toBe("ok")
        })
        test("GG_PERMISSIONS populated when resolver wired and caller has scopes", async () => {
            scope = withScopes(AppPermission.Read)
            const client = callOn(PermissionsApi, scope)
            // Handler returns "ok:authed" when GG_PERMISSIONS is present.
            expect(await client.publicMethod()).toBe("ok:authed")
        })
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
        test("empty header → no identity → NOT_AUTHORIZED on non-public", async () => {
            // Setting an empty list intentionally: the middleware only sets
            // GG_TEST_SCOPES if header value is non-empty. Empty scopes here
            // means no header is sent, so resolver returns null.
            scope = new GGContext("permissions-test-empty")
            scope.set(GG_TEST_SCOPES, [])
            await expect(callOn(PermissionsApi, scope).needsRead()).rejects.toThrow(/NOT_AUTHORIZED/)
        })
    })

    describe("resolver crashes", () => {
        test("resolver throws → SERVER_ERROR to caller (handler not invoked)", async () => {
            // Sentinel scope makes getTestScopes() throw an unrelated Error.
            // The gate's outer catch converts it to SERVER_ERROR via ERROR.fromUnknown.
            scope = withScopes(TEST_RESOLVER_THROW_SCOPE)
            await expect(callOn(PermissionsApi, scope).needsRead()).rejects.toThrow(/SERVER_ERROR/)
        })
        test("resolver throws on a public method → still SERVER_ERROR (gate runs the resolver to populate GG_PERMISSIONS)", async () => {
            // Even though the method is GG_NO_PERMISSIONS, the gate still calls
            // the resolver (to populate the checker for handler-side use). A
            // crashing resolver therefore breaks public endpoints too — a tradeoff
            // that's intentional: the resolver is meant to be reliable.
            scope = withScopes(TEST_RESOLVER_THROW_SCOPE)
            await expect(callOn(PermissionsApi, scope).publicMethod()).rejects.toThrow(/SERVER_ERROR/)
        })
    })
})
