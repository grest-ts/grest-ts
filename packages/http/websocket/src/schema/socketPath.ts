/**
 * The base of a socket path: a `"/base/*"` wildcard prefix maps to `"/base"`, an exact path is
 * itself. The single source of truth for stripping the wildcard suffix — used by path validation
 * and by the discovery registration (which routes by `startsWith(base)`).
 */
export function wildcardPathBase(path: string): string {
    return path.endsWith("/*") ? path.slice(0, -2) : path
}

/**
 * A WS path is matched against the upgrade request's pathname (after a leading slash is ensured),
 * so a path that is empty or carries whitespace / a query / a fragment can never match a real
 * connection — the schema would silently accept zero clients. Reject it at build time.
 *
 * A trailing `/*` makes the path a prefix (matches `/base` and anything under `/base/`), allowed
 * only when `allowPrefix` is set — i.e. on a customClient contract, where a foreign client opens
 * dynamic subpaths. A `*` anywhere else is rejected.
 */
export function assertValidSocketPath(path: string, apiName: string, allowPrefix = false): void {
    const isPrefix = path.endsWith("/*")
    const core = wildcardPathBase(path)
    if (core === "" || /\s/.test(core) || core.includes("?") || core.includes("#") || core.includes("*")) {
        throw new Error(
            `WebSocket schema "${apiName}": invalid path ${JSON.stringify(path)} — a WebSocket path must be ` +
            `non-empty and contain no whitespace, "?" or "#" (it is matched against the upgrade request pathname). ` +
            `A wildcard is only allowed as a trailing "/*".`
        )
    }
    if (isPrefix && !allowPrefix) {
        throw new Error(
            `WebSocket schema "${apiName}": a wildcard prefix path (${JSON.stringify(path)}) is only valid for a ` +
            `customClient contract — a foreign client opens dynamic subpaths, while a typed or grest-ts byte ` +
            `socket connects at one exact path (its createClient builds that exact URL).`
        )
    }
}
