/**
 * QUARANTINED — see ./README.md. Not wired into GGHttpServer.start().
 *
 * Strict-mode coverage: once any route declares a permission, every route on the server must
 * declare one (use GG_NO_PERMISSIONS for intentionally public routes). The old "orphaned
 * permission" arm is gone — there is no resolver wiring anymore; scopes come only from the
 * schema's wires, and a permissioned route on a wire-less schema simply fails closed at runtime.
 */
import {GGContractMethod, GGPermission} from "@grest-ts/schema"

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
): void {
    type Surface = {label: string; permission: GGPermission | undefined}
    const surfaces: Surface[] = []

    for (const schema of httpSchemas) {
        const methods = schema.contract?.methods ?? {}
        for (const name of Object.keys(methods)) {
            surfaces.push({label: `${schema.name}.${name}`, permission: methods[name].permission})
        }
    }
    for (const ws of webSocketSchemas) {
        const methods = ws.contract.clientToServer.methods
        for (const name of Object.keys(methods)) {
            surfaces.push({label: `${ws.name}.${name}`, permission: methods[name].permission})
        }
        if (ws.connectPermission !== undefined) {
            surfaces.push({label: `${ws.name} (connectPermission)`, permission: ws.connectPermission})
        }
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
