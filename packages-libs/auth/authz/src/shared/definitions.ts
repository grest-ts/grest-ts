export type GGAuthzActionRef = string | {readonly name: string}

type Kind = "service" | "role" | "token scope"

const registry = new Map<string, string | undefined>()

export function definedAtOf(kind: Kind, name: string): string | undefined {
    return registry.get(`${kind}:${name}`)
}

export function actionName(ref: GGAuthzActionRef): string {
    return typeof ref === "string" ? ref : ref.name
}

// Same name from the same place is a module re-evaluation (HMR, vitest projects), not a duplicate. Compared without the
// query an HMR reload adds (`?t=…`); an edit above the definition before a reload still reads as a duplicate.
export function register<T extends {definedAt?: string}>(kind: Kind, name: string, value: T): T {
    const key = `${kind}:${name}`
    if (registry.has(key) && placeOf(registry.get(key)) !== placeOf(value.definedAt)) {
        throw new Error(`Duplicate authz ${kind} ${name}: defined at ${registry.get(key) ?? "?"} and ${value.definedAt ?? "?"}`)
    }
    registry.set(key, value.definedAt)
    return value
}

function placeOf(at: string | undefined): string | undefined {
    return at?.replace(/\?[^:]*(?=:\d+:\d+$)/, "")
}

const SELF = import.meta.url.replace(/^file:\/\//, "").replace(/\/[^/]*$/, "/")

/** The first stack frame outside this directory: where the app called `define`. */
export function definedAt(): string | undefined {
    const frame = new Error().stack?.split("\n").slice(1).find(line => !line.includes(SELF))
    return frame?.trim().replace(/^at\s+/, "").replace(/^.*\((.*)\)$/, "$1")
}
