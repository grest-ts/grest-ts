import {GGRpc, GGHttpRequest, GGHttpTransportMiddleware, httpSchema} from "@grest-ts/http"
import {
    GG_ANY_PERMISSION,
    GG_NO_PERMISSIONS,
    GGContractClass,
    FORBIDDEN,
    IsArray,
    IsObject,
    IsString,
    NOT_AUTHORIZED,
    SERVER_ERROR,
} from "@grest-ts/schema"
import {GGContextKey} from "@grest-ts/context"

/**
 * App-specific scope catalog. Following plan §1 — projects centralize permission
 * names in an enum so typos become compile errors and refactors stay clean.
 */
export enum AppPermission {
    Read   = "perm:read",
    Write  = "perm:write",
    Admin  = "perm:admin",
    Owner  = "perm:owner",
}

/**
 * Context key that holds the caller's resolved scopes for a request.
 * In production this would be populated by a JWT auth middleware. Here the
 * test middleware reads them from a custom header so tests can drive the gate
 * deterministically without minting tokens.
 */
export const GG_TEST_SCOPES = new GGContextKey<string[]>("test-scopes", IsArray(IsString))

/**
 * Test auth middleware. Parses `x-test-scopes` header into GG_TEST_SCOPES.
 * Empty header / no header → no identity (null resolver result → NOT_AUTHORIZED
 * for non-public methods).
 */
export const TestAuthMiddleware: GGHttpTransportMiddleware = {
    headers: {
        "x-test-scopes": IsString.orUndefined.docs({description: "Comma-separated scopes for permission tests"}),
    },
    responseHeaders: {},
    parseRequest(req: GGHttpRequest): void {
        const raw = req.headers?.["x-test-scopes"]
        if (typeof raw === "string" && raw.length > 0) {
            GG_TEST_SCOPES.set(raw.split(",").map(s => s.trim()).filter(Boolean))
        }
    },
    updateRequest(req: GGHttpRequest): void {
        const scopes = GG_TEST_SCOPES.get()
        if (scopes && scopes.length > 0) {
            req.headers!["x-test-scopes"] = scopes.join(",")
        }
    },
}

/**
 * Sentinel scope value tests use to verify the gate behaves correctly when
 * the resolver itself throws (DB lookup failure, etc.). Sending this scope
 * in the test header makes the resolver throw a plain Error.
 */
export const TEST_RESOLVER_THROW_SCOPE = "__test:throw__"

/**
 * Scope resolver passed to GGHttp.usePermissions(). Reads from the context
 * the auth middleware populated — never parses headers itself.
 *
 * The TEST_RESOLVER_THROW_SCOPE sentinel is honored to exercise the gate's
 * defensive path: a resolver that crashes should surface as a SERVER_ERROR
 * to HTTP callers and a HANDSHAKE_ERR to WS callers.
 */
export const getTestScopes = (): ReadonlySet<string> | null => {
    const scopes = GG_TEST_SCOPES.get()
    if (!scopes) return null
    if (scopes.includes(TEST_RESOLVER_THROW_SCOPE)) throw new Error("resolver intentionally threw — test signal")
    return new Set(scopes)
}

export const PermissionsApiContract = new GGContractClass("PermissionsApi", {
    // Public endpoint — no auth needed.
    publicMethod: {
        success: IsString,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS,
    },
    // Any authenticated identity with at least one scope.
    anyAuth: {
        success: IsString,
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
        permission: GG_ANY_PERMISSION,
    },
    // Single scope.
    needsRead: {
        success: IsString,
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
        permission: AppPermission.Read,
    },
    // AllOf — must hold both scopes.
    needsReadAndWrite: {
        success: IsString,
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
        permission: {allOf: [AppPermission.Read, AppPermission.Write]},
    },
    // AnyOf — at least one of the listed scopes.
    needsReadOrAdmin: {
        success: IsString,
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
        permission: {anyOf: [AppPermission.Read, AppPermission.Admin]},
    },
    // Nested anyOf(allOf, ...) — exercises depth.
    nested: {
        success: IsString,
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
        permission: {anyOf: [{allOf: [AppPermission.Read, AppPermission.Write]}, AppPermission.Admin]},
    },
    // Handler does its own sub-check via GG_PERMISSIONS.
    checksInside: {
        input: IsObject({label: IsString}),
        success: IsObject({label: IsString, branch: IsString}),
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
        permission: {anyOf: [AppPermission.Admin, AppPermission.Owner]},
    },
})

export const PermissionsApi = httpSchema(PermissionsApiContract)
    .pathPrefix("api/permissions")
    .use(TestAuthMiddleware)
    .routes({
        publicMethod:       GGRpc.GET("public"),
        anyAuth:            GGRpc.GET("any"),
        needsRead:          GGRpc.GET("read"),
        needsReadAndWrite:  GGRpc.GET("read-write"),
        needsReadOrAdmin:   GGRpc.GET("read-or-admin"),
        nested:             GGRpc.GET("nested"),
        checksInside:       GGRpc.POST("checks-inside"),
    })
