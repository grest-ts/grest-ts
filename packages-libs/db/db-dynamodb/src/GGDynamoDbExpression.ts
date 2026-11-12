type Source = Record<string, unknown>

type KeysOf<U> = U extends unknown ? keyof U : never
/** A union whose members can't be mixed: `{lt: 1, gt: 2}` is not a `{lt} | {gt}`. */
type Exclusive<U, All = U> = U extends unknown ? U & {[K in Exclude<KeysOf<All>, keyof U>]?: never} : never

type Range<V> = {lt: V} | {lte: V} | {gt: V} | {gte: V} | {between: [V, V]}

/** One field's condition: exactly one operator. `size` is a string's length, or an array's, set's or map's element count. */
export type GGDynamoDbFieldCondition<V> = Exclusive<
    | {eq: V} | {ne: V} | {exists: boolean} | {in: V[]}
    | ([V] extends [string | number] ? Range<V> : never)
    | ([V] extends [string] ? {beginsWith: string} | {contains: string} : never)
    | ([V] extends [readonly (infer E)[]] ? {contains: E} : never)
    | {size: Exclusive<{eq: number} | {ne: number} | Range<number>>}
>

/** Fields AND-ed; `anyOf` OR-s whole conditions, `allOf` AND-s them (two conditions on one field). As in DynamoDB,
 *  `ne` holds on a row without the field: add `exists: true` through `allOf` to require it. */
export type GGDynamoDbCondition<T> = {[K in keyof T]?: GGDynamoDbFieldCondition<NonNullable<T[K]>>} & {
    anyOf?: GGDynamoDbCondition<T>[]
    allOf?: GGDynamoDbCondition<T>[]
}

/** Placeholders for one expression set. Every attribute goes through a name placeholder, so reserved words just work.
 *  Operands on a `sets` field are sent as sets, as the field is stored. */
export class GGDynamoDbExpr {
    readonly names: Record<string, string> = {}
    readonly values: Record<string, unknown> = {}
    private readonly byName = new Map<string, string>()
    private readonly sets: ReadonlySet<string>

    constructor(sets: ReadonlySet<string> = new Set()) {
        this.sets = sets
    }

    name(attr: string): string {
        let p = this.byName.get(attr)
        if (!p) {
            p = `#n${this.byName.size}`
            this.byName.set(attr, p)
            this.names[p] = attr
        }
        return p
    }

    value(v: unknown): string {
        const p = `:v${Object.keys(this.values).length}`
        this.values[p] = v
        return p
    }

    /** `attr` holds `v`, or is absent when `v` is undefined. */
    unchanged(attr: string, v: unknown): string {
        return v === undefined ? `attribute_not_exists(${this.name(attr)})` : `${this.name(attr)} = ${this.value(this.operand(attr, v))}`
    }

    condition(c: GGDynamoDbCondition<any>): string {
        const parts: string[] = []
        for (const [field, op] of Object.entries(c)) {
            if (op === undefined) continue
            if (field === "anyOf" || field === "allOf") {
                const nested = (op as GGDynamoDbCondition<any>[]).map(a => this.condition(a))
                if (nested.length === 0) throw new Error(`GGDynamoDb: ${field} needs at least one condition`)
                parts.push(`(${nested.join(field === "anyOf" ? " OR " : " AND ")})`)
            } else {
                parts.push(this.fieldCondition(field, this.name(field), op as Source))
            }
        }
        if (parts.length === 0) throw new Error("GGDynamoDb: empty condition")
        return parts.length === 1 ? parts[0] : `(${parts.join(" AND ")})`
    }

    /** `n` compared by `op`: `eq`, the ranges or `beginsWith`. */
    range(n: string, op: Source, operand: (v: unknown) => unknown = v => v): string {
        const [kind, v] = onlyOperator(n, op)
        const value = (x: unknown) => this.value(operand(x))
        switch (kind) {
            case "eq": return `${n} = ${value(v)}`
            case "lt": return `${n} < ${value(v)}`
            case "lte": return `${n} <= ${value(v)}`
            case "gt": return `${n} > ${value(v)}`
            case "gte": return `${n} >= ${value(v)}`
            case "between": return `${n} BETWEEN ${value((v as unknown[])[0])} AND ${value((v as unknown[])[1])}`
            case "beginsWith": return `begins_with(${n}, ${this.value(v)})`
        }
        throw new Error(`GGDynamoDb: unknown operator "${kind}" on ${n}`)
    }

    valuesInput(): {ExpressionAttributeValues?: Record<string, unknown>} {
        return Object.keys(this.values).length > 0 ? {ExpressionAttributeValues: this.values} : {}
    }

    private fieldCondition(field: string, n: string, op: Source): string {
        const [kind, v] = onlyOperator(field, op)
        switch (kind) {
            case "exists": return `${v ? "attribute_exists" : "attribute_not_exists"}(${n})`
            case "ne": return `${n} <> ${this.value(this.operand(field, v))}`
            case "in": {
                if ((v as unknown[]).length === 0) throw new Error(`GGDynamoDb: in on "${field}" needs at least one value`)
                return `${n} IN (${(v as unknown[]).map(x => this.value(this.operand(field, x))).join(", ")})`
            }
            case "contains": return `contains(${n}, ${this.value(v)})`
            case "size": return this.range(`size(${n})`, v as Source)
        }
        return this.range(n, op, x => this.operand(field, x))
    }

    private operand(field: string, v: unknown): unknown {
        return this.sets.has(field) && Array.isArray(v) ? new Set(v) : v
    }
}

function onlyOperator(field: string, op: Source): [string, unknown] {
    const set = Object.entries(op).filter(([, v]) => v !== undefined)
    if (set.length !== 1) throw new Error(`GGDynamoDb: the condition on "${field}" needs exactly one operator, got ${set.map(([k]) => k).join(", ") || "none"}`)
    return set[0]
}

/** Values a condition proves the row holds: top-level (and `allOf`) `eq`, and `exists: false` as undefined. */
export function conditionPins(c: GGDynamoDbCondition<any> | undefined): Source {
    const out: Source = {}
    for (const [field, op] of Object.entries(c ?? {})) {
        if (op === undefined || field === "anyOf") continue
        if (field === "allOf") Object.assign(out, ...(op as GGDynamoDbCondition<any>[]).map(conditionPins))
        else if ("eq" in op) out[field] = op.eq
        else if ("exists" in op && op.exists === false) out[field] = undefined
    }
    return out
}

/** Every field a condition reads. */
export function conditionFields(c: GGDynamoDbCondition<any>): string[] {
    return Object.entries(c).flatMap(([field, op]) =>
        field === "anyOf" || field === "allOf" ? (op as GGDynamoDbCondition<any>[]).flatMap(conditionFields) : [field])
}
