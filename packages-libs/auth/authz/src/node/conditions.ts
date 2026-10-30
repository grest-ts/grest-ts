import type {GGAuthzCondition} from "../shared/authzSchemas"

/** `undefined` = unknown: a missing attribute, or one of the wrong type for the operator. */
export type Tri = boolean | undefined

export type AttributeLookup = (key: string) => unknown

export function evalConditional(c: {when?: readonly string[], unless?: readonly string[], conditions?: readonly GGAuthzCondition[]}, fact: (name: string) => Tri, get: AttributeLookup): Tri {
    let unknown = false
    for (const f of c.when ?? []) {
        const value = fact(f)
        if (value === false) return false
        if (value === undefined) unknown = true
    }
    for (const f of c.unless ?? []) {
        const value = fact(f)
        if (value === true) return false
        if (value === undefined) unknown = true
    }
    const attributes = evalConditions(c.conditions, get)
    if (attributes === false) return false
    return unknown || attributes === undefined ? undefined : true
}

export function evalConditions(conditions: readonly GGAuthzCondition[] | undefined, get: AttributeLookup): Tri {
    let unknown = false
    for (const c of conditions ?? []) {
        const value = evalCondition(c, get)
        if (value === false) return false
        if (value === undefined) unknown = true
    }
    return unknown ? undefined : true
}

export function evalCondition(c: GGAuthzCondition, get: AttributeLookup): Tri {
    const left = known(get(c.key))
    if (c.op === "present") return (left !== undefined) === c.value
    const right = c.ref !== undefined ? known(get(c.ref)) : c.value
    if (left === undefined || right === undefined) return undefined
    switch (c.op) {
        case "eq":
            return equal(left, right)
        case "ne":
            return !equal(left, right)
        case "in":
            return Array.isArray(right) ? right.some(v => equal(v, left)) : undefined
        case "notIn":
            return Array.isArray(right) ? !right.some(v => equal(v, left)) : undefined
        case "contains":
            return Array.isArray(left) ? left.some(v => equal(v, right)) : undefined
        case "startsWith":
            return typeof left === "string" && typeof right === "string" ? left.startsWith(right) : undefined
        default: {
            if (typeof left !== "number" || typeof right !== "number") return undefined
            return c.op === "lt" ? left < right : c.op === "le" ? left <= right : c.op === "gt" ? left > right : left >= right
        }
    }
}

export function isResourceKey(key: string): boolean {
    return key.startsWith("resource.")
}

function known(value: unknown): unknown {
    return value === null ? undefined : value
}

function equal(a: unknown, b: unknown): boolean {
    if (!Array.isArray(a) || !Array.isArray(b)) return a === b
    const left = new Set(a)
    const right = new Set(b)
    return left.size === right.size && [...left].every(x => right.has(x))
}
