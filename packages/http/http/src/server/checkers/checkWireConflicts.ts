/**
 * Run at GGHttpServer.start() over the frozen schema graph: the wires a single schema .use()s
 * must not conflict with each other. Two conflicts are caught:
 *   - same context-key name → both wires resolve to one storage slot; parse() of one clobbers
 *     the value the other read.
 *   - same inbound header / cookie → both wires read (and a client writes) the same transport
 *     field; one silently overwrites the other in parse()/update().
 * Both are per-schema: the same wire reused across different schemas is fine.
 */
import type {GGTransportMiddleware} from "@grest-ts/context"
import {GGWireContextKey} from "../../schema/GGWireContextKey"

interface SchemaLike {
    name: string
    wires: readonly GGTransportMiddleware[]
}

function transportKeys(mw: GGTransportMiddleware): string[] {
    return [
        ...Object.keys(mw.headers ?? {}).map(h => `header "${h.toLowerCase()}"`),
        ...Object.keys(mw.cookieParams ?? {}).map(c => `cookie "${c}"`),
    ]
}

export function checkWireConflicts(
    httpSchemas: readonly {name: string; apiMiddlewares: readonly GGTransportMiddleware[]}[],
    webSocketSchemas: readonly {name: string; middlewares: readonly GGTransportMiddleware[]}[],
): void {
    const schemas: SchemaLike[] = [
        ...httpSchemas.map(s => ({name: s.name, wires: s.apiMiddlewares})),
        ...webSocketSchemas.map(s => ({name: s.name, wires: s.middlewares})),
    ]

    const conflicts: string[] = []
    for (const schema of schemas) {
        const names = new Map<string, GGWireContextKey>()
        const fields = new Map<string, GGTransportMiddleware>()

        for (const mw of schema.wires) {
            if (mw instanceof GGWireContextKey) {
                if (names.has(mw.name)) {
                    conflicts.push(`  ${schema.name}: two wires share context-key name "${mw.name}"`)
                } else {
                    names.set(mw.name, mw)
                }
            }
            for (const field of transportKeys(mw)) {
                if (fields.has(field)) {
                    conflicts.push(`  ${schema.name}: two wires bind the same ${field}`)
                } else {
                    fields.set(field, mw)
                }
            }
        }
    }

    if (conflicts.length > 0) {
        throw new Error(
            `GGHttpServer: conflicting wires .use()d on one schema:\n\n` +
            conflicts.join("\n") +
            `\n\nFix: a schema must not .use() two wires that share a context-key name or read the ` +
            `same header/cookie — one silently clobbers the other.`
        )
    }
}
