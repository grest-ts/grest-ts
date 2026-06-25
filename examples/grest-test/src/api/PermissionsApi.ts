import {GGRpc, GGHeader, GGHttpSchema} from "@grest-ts/http"
import {GGContextKey} from "@grest-ts/context"
import {
    GG_ANY_PERMISSION,
    GGContractClass,
    FORBIDDEN,
    IsArray,
    IsObject,
    IsString,
    NOT_AUTHORIZED,
    SERVER_ERROR,
    VALIDATION_ERROR,
} from "@grest-ts/schema"
import {enumOf, type Values} from "@grest-ts/common"

/**
 * App-specific scope catalog. Following plan §1 — projects centralize permission
 * names so typos become compile errors and refactors stay clean.
 */
export const AppPermission = enumOf({
    Read:  "perm:read",
    Write: "perm:write",
    Admin: "perm:admin",
    Owner: "perm:owner",
})
export type AppPermission = Values<typeof AppPermission>

/**
 * Sentinel scope value tests use to verify the gate behaves correctly when
 * the wire's permissions() itself throws (DB lookup failure, etc.). Sending this
 * scope in the test header makes permissions() throw a plain Error.
 */
export const TEST_RESOLVER_THROW_SCOPE = "__test:throw__"

/**
 * Required-throw credential wire. process() rejects with NOT_AUTHORIZED when the
 * header is absent (no caller identity); permissions() yields the comma-separated
 * scopes the header carries. In production this would verify a JWT; here tests
 * drive the gate deterministically by setting the wire's value.
 */
// Durable scopes minted in process() — read by permissions() AFTER the ephemeral
// credential has been cleared (the HTTP gate resolves scopes once clear() has run).
export const TEST_SCOPES_DATA = new GGContextKey<string[]>("test-scopes-data", IsArray(IsString))

export const TEST_SCOPES_WIRE = new GGHeader("x-test-scopes")
export const TEST_SCOPES_WIRE_HANDLER = TEST_SCOPES_WIRE.define(() => ({
    process: async () => {
        const raw = TEST_SCOPES_WIRE.get()
        if (raw === undefined) throw new NOT_AUTHORIZED({debugMessage: "no caller identity"})
        TEST_SCOPES_DATA.set(raw.split(",").map(s => s.trim()).filter(Boolean))
    },
    permissions: async () => {
        const scopes = TEST_SCOPES_DATA.get() ?? []
        if (scopes.includes(TEST_RESOLVER_THROW_SCOPE)) throw new Error("resolver intentionally threw — test signal")
        return scopes
    },
}))

export const PermissionsApiContract = new GGContractClass("PermissionsApi", {
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
    // Handler does its own sub-check by reading the durable principal the wire minted.
    checksInside: {
        input: IsObject({label: IsString}),
        success: IsObject({label: IsString, branch: IsString}),
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
        permission: {anyOf: [AppPermission.Admin, AppPermission.Owner]},
    },
})

export const PermissionsApi = new GGHttpSchema({
    contract: PermissionsApiContract,
    pathPrefix: "api/permissions",
    use: [TEST_SCOPES_WIRE],
    routes: {
        anyAuth:            GGRpc.GET("any"),
        needsRead:          GGRpc.GET("read"),
        needsReadAndWrite:  GGRpc.GET("read-write"),
        needsReadOrAdmin:   GGRpc.GET("read-or-admin"),
        nested:             GGRpc.GET("nested"),
        checksInside:       GGRpc.POST("checks-inside"),
    },
})
