/**
 * Run at GGHttpServer.start() over the frozen schema graph. Three permission-coherence checks:
 *
 *  - strict-mode coverage: once any route declares a permission, every route on the server must
 *    declare one (use GG_NO_PERMISSIONS for intentionally public routes).
 *  - unsatisfiable route: a route requiring a non-public permission on a schema with no
 *    permission-resolving wire (a .define()d wire whose handler exposes permissions()) can never
 *    pass the gate — its pooled grants are always empty, so it is permanently FORBIDDEN.
 *  - dead serverToClient permission: the gate has no caller identity for server-pushed messages,
 *    so a non-public permission on a WS serverToClient method is silently ignored.
 *
 * Scopes come only from the schema's wires; there is no resolver wiring.
 *
 * Plus one for requirements: an HTTP schema whose methods declare a GGRequirement must .use() exactly one
 * GGAuthority, and that authority must be created in this runtime.
 */
import {GG_NO_PERMISSIONS, GGContractMethod, GGPermission, GGPermissionChecker} from "@grest-ts/schema"
import type {GGTransportMiddleware} from "@grest-ts/context"
import {GGWireContextKey} from "../../schema/GGWireContextKey"
import "../../schema/GGWireContextKey.node.js"
import {GGAuthority} from "../../schema/GGAuthority"
import "../../schema/GGAuthority.node.js"

interface HttpSchemaLike {
    name: string
    apiMiddlewares: readonly GGTransportMiddleware[]
    contract?: {methods: Record<string, GGContractMethod>}
}

interface WebSocketSchemaLike {
    name: string
    middlewares: readonly GGTransportMiddleware[]
    contract: {
        connect: {method: GGContractMethod}
        // Absent on byte-stream (raw) schemas — they carry only `connect`.
        clientToServer?: {methods: Record<string, GGContractMethod>}
        serverToClient?: {methods: Record<string, GGContractMethod>}
    }
}

function isNonPublic(permission: GGPermission | undefined): boolean {
    return permission !== undefined && permission !== GG_NO_PERMISSIONS
}

// A permission made only of requirements needs no grants from a wire — its authority decides it.
function needsWireGrants(permission: GGPermission | undefined): boolean {
    return isNonPublic(permission) && !GGPermissionChecker.satisfiesDeferring(permission!, [])
}

function checkAuthorities(httpSchemas: readonly HttpSchemaLike[]): void {
    const problems: string[] = []
    for (const schema of httpSchemas) {
        const methods = schema.contract?.methods ?? {}
        const withRequirements = Object.keys(methods).filter(name => GGPermissionChecker.requirementsOf(methods[name].permission).length)
        if (!withRequirements.length) continue
        const authorities = schema.apiMiddlewares.filter((mw): mw is GGAuthority => mw instanceof GGAuthority)
        if (authorities.length !== 1) {
            problems.push(`  ${schema.name}: ${withRequirements.join(", ")} declare requirements, but the schema .use()s ${authorities.length} authorities (needs exactly one)`)
        } else if (!authorities[0]!.hasHandler()) {
            problems.push(`  ${schema.name}: authority "${authorities[0]!.name}" is not created - call ${authorities[0]!.name}.define(...).create(deps) in compose()`)
        }
    }
    if (problems.length) {
        throw new Error(`GGHttpServer: these schemas have requirements nothing can decide:\n\n${problems.join("\n")}`)
    }
}

function hasPermissionWire(wires: readonly GGTransportMiddleware[]): boolean {
    return wires.some(mw => mw instanceof GGWireContextKey && mw.hasPermissions())
}

export function checkPermissionsAtStart(
    httpSchemas: readonly HttpSchemaLike[],
    webSocketSchemas: readonly WebSocketSchemaLike[],
): void {
    type Surface = {label: string; permission: GGPermission | undefined; hasWire: boolean}
    const surfaces: Surface[] = []
    const deadServerToClient: string[] = []

    for (const schema of httpSchemas) {
        const hasWire = hasPermissionWire(schema.apiMiddlewares)
        const methods = schema.contract?.methods ?? {}
        for (const name of Object.keys(methods)) {
            surfaces.push({label: `${schema.name}.${name}`, permission: methods[name].permission, hasWire})
        }
    }
    for (const ws of webSocketSchemas) {
        const hasWire = hasPermissionWire(ws.middlewares)
        const connectPermission = ws.contract.connect.method.permission
        if (connectPermission !== undefined) {
            surfaces.push({label: `${ws.name} (connect)`, permission: connectPermission, hasWire})
        }
        const clientToServer = ws.contract.clientToServer?.methods
        if (clientToServer) {
            for (const name of Object.keys(clientToServer)) {
                surfaces.push({label: `${ws.name}.${name}`, permission: clientToServer[name].permission, hasWire})
            }
        }
        const serverToClient = ws.contract.serverToClient?.methods
        if (serverToClient) {
            for (const name of Object.keys(serverToClient)) {
                if (isNonPublic(serverToClient[name].permission)) deadServerToClient.push(`  ${ws.name}.${name}`)
            }
        }
    }

    if (deadServerToClient.length > 0) {
        throw new Error(
            `GGHttpServer: these WebSocket serverToClient methods declare a non-public permission, ` +
            `but server-pushed messages have no caller to gate — the permission is silently ignored:\n\n` +
            deadServerToClient.join("\n") +
            `\n\nFix: set \`permission: GG_NO_PERMISSIONS\` on serverToClient methods.`
        )
    }

    checkAuthorities(httpSchemas)

    const unsatisfiable = surfaces.filter(s => needsWireGrants(s.permission) && !s.hasWire)
    if (unsatisfiable.length > 0) {
        const lines = unsatisfiable.map(s => `  ${s.label}`).join("\n")
        throw new Error(
            `GGHttpServer: these routes require a permission but their schema .use()s no wire that ` +
            `resolves permissions — they can never pass the gate (permanently FORBIDDEN):\n\n` +
            lines +
            `\n\nFix: .use() an auth wire whose handler exposes permissions(), or set the route to ` +
            `\`GG_NO_PERMISSIONS\` if it is meant to be public.`
        )
    }

    let strict = false
    const undeclared: Surface[] = []
    for (const s of surfaces) {
        if (s.permission !== undefined) strict = true
        if (s.permission === undefined) undeclared.push(s)
    }
    if (!strict) return

    if (undeclared.length > 0) {
        const lines = undeclared.map(s => `  ${s.label}`).join("\n")
        throw new Error(
            `GGHttpServer: permission strict mode is active on this server ` +
            `(at least one route declares a permission), ` +
            `but the following routes have no \`permission\` declared:\n\n` +
            lines +
            `\n\nFix: declare \`permission\` on every route — use \`GG_NO_PERMISSIONS\` for intentionally public ones.`
        )
    }
}
