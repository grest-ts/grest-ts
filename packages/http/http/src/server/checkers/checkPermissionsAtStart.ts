/**
 * QUARANTINED — see ./README.md. Not wired into GGHttpServer.start().
 *
 * Needs a "does this schema have a scope resolver?" input. The live `_schemasWithResolver`
 * side-set that fed it was removed; when restored, derive this in a post-compose pass over the
 * fully-assembled graph (a wire-bearing or .usePermissions()'d schema has a resolver) rather than
 * from a side-set populated during wiring.
 */
import {describePermission, GG_NO_PERMISSIONS, GGContractMethod, GGPermission} from "@grest-ts/schema"

interface HttpSchemaLike {
    name: string
    contract?: {methods: Record<string, GGContractMethod>}
}

interface WebSocketSchemaLike {
    name: string
    contract: {clientToServer: {methods: Record<string, GGContractMethod>}}
    connectPermission?: GGPermission
}

export function checkPermissionsAtStart(
    httpSchemas: readonly HttpSchemaLike[],
    webSocketSchemas: readonly WebSocketSchemaLike[],
    schemasWithResolver: ReadonlySet<object>,
): void {
    type Surface = {label: string; permission: GGPermission | undefined; resolverWired: boolean}
    const surfaces: Surface[] = []

    for (const schema of httpSchemas) {
        const resolverWired = schemasWithResolver.has(schema)
        const methods = schema.contract?.methods ?? {}
        for (const name of Object.keys(methods)) {
            surfaces.push({
                label: `${schema.name}.${name}`,
                permission: methods[name].permission,
                resolverWired,
            })
        }
    }
    for (const ws of webSocketSchemas) {
        const resolverWired = schemasWithResolver.has(ws)
        const methods = ws.contract.clientToServer.methods
        for (const name of Object.keys(methods)) {
            surfaces.push({
                label: `${ws.name}.${name}`,
                permission: methods[name].permission,
                resolverWired,
            })
        }
        if (ws.connectPermission !== undefined) {
            surfaces.push({
                label: `${ws.name} (connectPermission)`,
                permission: ws.connectPermission,
                resolverWired,
            })
        }
    }

    let strict = false
    const undeclared: Surface[] = []
    const orphaned: Surface[] = []
    for (const s of surfaces) {
        if (s.permission !== undefined || s.resolverWired) strict = true
        if (s.permission === undefined) undeclared.push(s)
        else if (s.permission !== GG_NO_PERMISSIONS && !s.resolverWired) orphaned.push(s)
    }
    if (!strict) return

    if (undeclared.length > 0) {
        const lines = undeclared.map(s => `  ${s.label}`).join("\n")
        throw new Error(
            `GGHttpServer: permission strict mode is active on this server ` +
            `(at least one route declares a permission or has .usePermissions(...) wired), ` +
            `but the following routes have no \`permission\` declared:\n\n` +
            lines +
            `\n\nFix: declare \`permission\` on every route — use \`GG_NO_PERMISSIONS\` for intentionally public ones.`
        )
    }
    if (orphaned.length > 0) {
        const lines = orphaned.map(s =>
            `  ${s.label}   requires ${describePermission(s.permission)}`
        ).join("\n")
        throw new Error(
            `GGHttpServer: these routes declare non-public permissions but their schema was ` +
            `registered without a scope resolver:\n\n` +
            lines +
            `\n\nFix: call \`.usePermissions(yourResolver)\` on the GGHttp chain (or pass ` +
            `\`permissionResolver\` to the WS schema config) before registering these routes.`
        )
    }
}
