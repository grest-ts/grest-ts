/**
 * Run at GGHttpServer.start() over the frozen schema graph: every wire a schema
 * .use()s and that is .define()d must have a .create()d handler on this runtime.
 */
import {GGWireContextKey} from "../../schema/GGWireContextKey"
import {wireIsDefined} from "../../schema/GGWireContextKey.node"

interface HttpSchemaLike {
    name: string
    apiMiddlewares: readonly unknown[]
}

interface WebSocketSchemaLike {
    name: string
    middlewares: readonly unknown[]
}

export function checkWiresImplemented(
    httpSchemas: readonly HttpSchemaLike[],
    webSocketSchemas: readonly WebSocketSchemaLike[],
): void {
    const surfaces: {name: string; wires: readonly unknown[]}[] = [
        ...httpSchemas.map(s => ({name: s.name, wires: s.apiMiddlewares})),
        ...webSocketSchemas.map(s => ({name: s.name, wires: s.middlewares})),
    ]
    const missing: string[] = []
    for (const surface of surfaces) {
        for (const mw of surface.wires) {
            if (mw instanceof GGWireContextKey && wireIsDefined(mw) && !mw.hasHandler()) {
                missing.push(`  ${surface.name}  uses wire "${mw.name}"`)
            }
        }
    }
    if (missing.length > 0) {
        throw new Error(
            `GGHttpServer: these schemas .use() a smart wire that was never implemented on this ` +
            `runtime:\n\n` +
            missing.join("\n") +
            `\n\nFix: call \`${"<WIRE>"}.define(...).create(deps)\` in compose() before the server starts.`
        )
    }
}
