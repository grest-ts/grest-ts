/**
 * Run at GGHttpServer.start() over the frozen schema graph: every wire a schema
 * .use()s and that is .define()d must have a .create()d handler on this runtime.
 */
import {GGWireContextKey} from "../../schema/GGWireContextKey"
import {wireIsDefined} from "../../schema/GGWireContextKey.node.js"
import {expandWireAlternatives, GGWireAlternatives} from "../../schema/GGWireAlternatives"
import type {GGTransportMiddleware} from "@grest-ts/context"

interface HttpSchemaLike {
    name: string
    apiMiddlewares: readonly GGTransportMiddleware[]
}

interface WebSocketSchemaLike {
    name: string
    middlewares: readonly GGTransportMiddleware[]
}

export function checkWiresImplemented(
    httpSchemas: readonly HttpSchemaLike[],
    webSocketSchemas: readonly WebSocketSchemaLike[],
): void {
    const surfaces: {name: string; wires: readonly GGTransportMiddleware[]}[] = [
        ...httpSchemas.map(s => ({name: s.name, wires: s.apiMiddlewares})),
        ...webSocketSchemas.map(s => ({name: s.name, wires: s.middlewares})),
    ]
    const unverified: string[] = []
    const missing: string[] = []
    for (const surface of surfaces) {
        for (const mw of surface.wires) {
            if (!(mw instanceof GGWireAlternatives)) continue
            for (const group of mw.groups) {
                if (!group.some(wireIsDefined)) unverified.push(`  ${surface.name}  [${group.map(w => w.name).join(", ")}]`)
            }
        }
        for (const mw of expandWireAlternatives(surface.wires)) {
            if (mw instanceof GGWireContextKey && wireIsDefined(mw) && !mw.hasHandler()) {
                missing.push(`  ${surface.name}  uses wire "${mw.name}"`)
            }
        }
    }
    if (unverified.length > 0) {
        throw new Error(`GGHttpServer: every GGWireAlternatives group needs a .define()d wire to authenticate it:\n\n${unverified.join("\n")}`)
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
