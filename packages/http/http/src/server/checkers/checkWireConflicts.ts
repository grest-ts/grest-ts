/**
 * Run at GGHttpServer.start() over the frozen schema graph: the wires a single schema .use()s
 * must not read the same inbound header / cookie: both would read (and a client write) the same
 * transport field, and one silently overwrites the other in parse()/update(). Per-schema: the
 * same wire reused across different schemas is fine. (Two wires can't share a context key:
 * GGContextKey refuses a second key of one name.)
 */
import type {GGTransportMiddleware} from "@grest-ts/context"
import {expandWireAlternatives} from "../../schema/GGWireAlternatives"

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
        ...httpSchemas.map(s => ({name: s.name, wires: expandWireAlternatives(s.apiMiddlewares)})),
        ...webSocketSchemas.map(s => ({name: s.name, wires: expandWireAlternatives(s.middlewares)})),
    ]

    const conflicts: string[] = []
    for (const schema of schemas) {
        const fields = new Map<string, GGTransportMiddleware>()

        for (const mw of schema.wires) {
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
            `\n\nFix: a schema must not .use() two wires that read the same header/cookie — one ` +
            `silently clobbers the other.`
        )
    }
}
