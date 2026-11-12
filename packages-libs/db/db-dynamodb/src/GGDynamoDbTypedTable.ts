import {BatchGetCommand, type BatchGetCommandOutput, UpdateCommand} from "@aws-sdk/lib-dynamodb"
import type {GGDynamoDb, GGDynamoDbPage, GGDynamoDbTransactItem} from "./GGDynamoDb"
import type {
    GGDynamoDbArrayFields, GGDynamoDbAttrValue, GGDynamoDbDerivedMap, GGDynamoDbNumberFields, GGDynamoDbIndexDef, GGDynamoDbIndexRow, GGDynamoDbKeyInput, GGDynamoDbResolvedIndex,
    GGDynamoDbTableKey, GGDynamoDbTableSpec,
} from "./GGDynamoDbTableSpec"

type Source = Record<string, unknown>

type FieldCondition<V> = {eq: V} | {ne: V} | {exists: boolean}

/** Fields AND-ed; `anyOf` OR-s whole conditions, `allOf` AND-s them (two conditions on one field). As in DynamoDB,
 *  `ne` holds on a row without the field: add `exists: true` through `allOf` to require it. */
export type GGDynamoDbCondition<T> = {[K in keyof T]?: FieldCondition<NonNullable<T[K]>>} & {
    anyOf?: GGDynamoDbCondition<T>[]
    allOf?: GGDynamoDbCondition<T>[]
}

export type GGDynamoDbSkCondition<V> =
    | {eq: V} | {lt: V} | {lte: V} | {gt: V} | {gte: V} | {between: [V, V]}
    | (V extends string ? {beginsWith: string} : never)

export interface GGDynamoDbTypedQueryPageOptions<SkV> {
    sk?: [SkV] extends [never] ? never : GGDynamoDbSkCondition<SkV>
    limit?: number
    /** Walk the sort key backwards. */
    descending?: boolean
    cursor?: string
}

/** Base-table queries only: a GSI is always eventually consistent. */
export interface GGDynamoDbConsistentReadOption {
    consistentRead?: boolean
}

export interface GGDynamoDbTypedQueryOptions<T, SkV> extends Omit<GGDynamoDbTypedQueryPageOptions<SkV>, "cursor"> {
    /** Applied after the read: filtered-out rows are still read and billed. Not on `queryPage`, where DynamoDB's
     *  Limit counts rows before the filter and a page would come back short or empty while matches remain. */
    filter?: GGDynamoDbCondition<T>
}

export interface GGDynamoDbWriteOptions<T> {
    if?: GGDynamoDbCondition<T>
}

export interface GGDynamoDbUpdateOptions<T> extends GGDynamoDbWriteOptions<T> {
    /** The row the caller read. Supplies a derived key's inputs `fields` leaves out, and the write then only lands
     *  while those still hold. */
    current?: T
    /** Atomic: adds to a number field (from 0 when absent), or elements to a `sets` field. */
    add?: {[K in GGDynamoDbNumberFields<T> | GGDynamoDbArrayFields<T>]?: NonNullable<T[K]>}
    /** Atomic: removes elements from a `sets` field; DynamoDB drops the attribute once the set is empty. */
    delete?: {[K in GGDynamoDbArrayFields<T>]?: NonNullable<T[K]>}
    /** Create the row when it doesn't exist (with just the key and what this update writes), instead of returning
     *  undefined. Writes every derived attribute, so all their inputs must be known as for a touched one. */
    upsert?: boolean
}

export interface GGDynamoDbBackfillResult {
    scanned: number
    rewritten: number
    /** Rows changed by another writer between the read and the rewrite; that writer derived their keys. */
    conflicts: number
    /** Absent once the table is done. */
    cursor: string | undefined
}

/** The bound table type for a spec: `private readonly users: GGDynamoDbTableOf<typeof UsersTable>`. */
export type GGDynamoDbTableOf<S> = S extends GGDynamoDbTableSpec<infer T, infer PK, infer SK, infer D, infer I> ? GGDynamoDbTypedTable<T, PK, SK, D, I> : never

type QueryArgs<K, O> = {} extends K ? [key?: K, opts?: O] : [key: K, opts?: O]

const BATCH_GET_MAX_KEYS = 100
const BATCH_GET_MAX_ATTEMPTS = 8
const BATCH_GET_FIRST_RETRY_MS = 50

/**
 * A `GGDynamoDbTableSpec` bound to a connection. Every write computes the spec's derived attributes; every read strips
 * them. Queries go through `index.<name>` with key parts and sort-key conditions typed from the spec.
 */
export class GGDynamoDbTypedTable<
    T extends object,
    PK extends keyof T & string,
    SK extends keyof T & string | undefined,
    D extends GGDynamoDbDerivedMap,
    I extends Record<string, GGDynamoDbIndexDef>,
> {

    public readonly index: {[K in keyof I]: GGDynamoDbIndexQuery<T, D, GGDynamoDbIndexRow<T, PK, SK, I[K]>, I[K]["pk"], I[K] extends {sk: infer S} ? S : never>}
    public readonly tx: GGDynamoDbTransactBuilder<T, PK, SK>
    public readonly spec: GGDynamoDbTableSpec<T, PK, SK, D, I>
    private readonly db: GGDynamoDb
    private readonly base: GGDynamoDbIndexQuery<T, D, T, PK, SK>

    constructor(db: GGDynamoDb, spec: GGDynamoDbTableSpec<T, PK, SK, D, I>) {
        this.db = db
        this.spec = spec
        this.index = Object.fromEntries(Object.entries(spec.indexes).map(([k, i]) => [k, new GGDynamoDbIndexQuery(db, this, i as GGDynamoDbResolvedIndex)])) as any
        this.base = new GGDynamoDbIndexQuery(db, this, spec.tableIndex)
        this.tx = new GGDynamoDbTransactBuilder(this)
    }

    get tableName(): string {
        return this.spec.name
    }

    /** Strongly consistent by default, as `GGDynamoDb.get`. */
    async get(key: GGDynamoDbTableKey<T, PK, SK>, opts?: {consistentRead?: boolean}): Promise<T | undefined> {
        return this.fromStored(await this.db.get<Source>(this.tableName, this.tableKey(key), opts))
    }

    /** Rows for `keys` in no particular order; missing ones are skipped. Eventually consistent. */
    async getMany(keys: GGDynamoDbTableKey<T, PK, SK>[]): Promise<T[]> {
        const rows: T[] = []
        for (let i = 0; i < keys.length; i += BATCH_GET_MAX_KEYS) {
            let pending: Source[] | undefined = keys.slice(i, i + BATCH_GET_MAX_KEYS).map(k => this.tableKey(k))
            for (let attempt = 0; pending && pending.length > 0; attempt++) {
                if (attempt === BATCH_GET_MAX_ATTEMPTS) throw new Error(`${this.tableName}.getMany: ${pending.length} key(s) still unprocessed after ${attempt} attempts`)
                // Throttled keys come back as UnprocessedKeys, to be resent after a backoff.
                if (attempt > 0) await new Promise(r => setTimeout(r, Math.random() * BATCH_GET_FIRST_RETRY_MS * 2 ** (attempt - 1)))
                const res: BatchGetCommandOutput = await this.db.getDocumentClient().send(new BatchGetCommand({RequestItems: {[this.tableName]: {Keys: pending}}}))
                rows.push(...(res.Responses?.[this.tableName] ?? []).map(r => this.fromStored<T>(r)!))
                pending = res.UnprocessedKeys?.[this.tableName]?.Keys
            }
        }
        return rows
    }

    query(...args: QueryArgs<GGDynamoDbKeyInput<T, D, PK>, GGDynamoDbTypedQueryOptions<T, SK extends string ? GGDynamoDbAttrValue<T, D, SK> : never> & GGDynamoDbConsistentReadOption>): Promise<T[]> {
        return this.base.query(...args as [any, any])
    }

    queryPage(...args: QueryArgs<GGDynamoDbKeyInput<T, D, PK>, GGDynamoDbTypedQueryPageOptions<SK extends string ? GGDynamoDbAttrValue<T, D, SK> : never> & GGDynamoDbConsistentReadOption>): Promise<GGDynamoDbPage<T>> {
        return this.base.queryPage(...args as [any, any])
    }

    /** Validates, derives, writes the whole row. False when `opts.if` fails. */
    async put(row: T, opts?: GGDynamoDbWriteOptions<T>): Promise<boolean> {
        const p = this.putParams(row, opts)
        if (!p.ConditionExpression) {
            await this.db.put(this.tableName, p.Item)
            return true
        }
        return this.db.putConditional(this.tableName, p.Item, p.ConditionExpression, p.ExpressionAttributeValues, p.ExpressionAttributeNames)
    }

    /**
     * Sets `fields` on an existing row; a field given as `undefined` is removed. Derived attributes whose inputs `fields`
     * touches are rewritten in the same write, from inputs the write proves: `fields`, an `eq` / `exists: false` in
     * `opts.if`, or `opts.current` (then conditioned on). Throws when an input is none of those, or is changed by
     * `opts.add` / `opts.delete`, whose result the write can't know.
     * Returns the updated row, or undefined when it doesn't exist (unless `opts.upsert`) or `opts.if` fails.
     */
    async update(key: GGDynamoDbTableKey<T, PK, SK>, fields: Partial<Omit<T, PK | (SK & string)>>, opts?: GGDynamoDbUpdateOptions<T>): Promise<T | undefined> {
        try {
            const res = await this.db.getDocumentClient().send(new UpdateCommand({...this.updateParams(key, fields as Source, opts), ReturnValues: "ALL_NEW"}))
            return this.fromStored(res.Attributes)
        } catch (err) {
            if (isConditionFailed(err)) return undefined
            throw err
        }
    }

    /** False when `opts.if` fails. */
    async delete(key: GGDynamoDbTableKey<T, PK, SK>, opts?: GGDynamoDbWriteOptions<T>): Promise<boolean> {
        const k = this.tableKey(key)
        if (!opts?.if) {
            await this.db.delete(this.tableName, k)
            return true
        }
        const e = new Expr()
        return this.db.deleteConditional(this.tableName, k, e.condition(opts.if), e.valuesOrUndefined(), e.names)
    }

    /** Every row (capped like `GGDynamoDb.scan`). `filter` trims what comes back, not what is read. */
    async scan(opts?: {filter?: GGDynamoDbCondition<T>, limit?: number, consistentRead?: boolean}): Promise<T[]> {
        const e = new Expr()
        const filter = opts?.filter && e.condition(opts.filter)
        const rows = await this.db.scan<Source>(this.tableName, {limit: opts?.limit, consistentRead: opts?.consistentRead, filter, names: e.names, values: e.values})
        return rows.map(r => this.fromStored(r)!)
    }

    async scanPage(opts?: {limit?: number, cursor?: string, consistentRead?: boolean}): Promise<GGDynamoDbPage<T>> {
        const page = await this.db.scanPage<Source>(this.tableName, opts)
        return {items: page.items.map(r => this.fromStored(r)!), cursor: page.cursor}
    }

    /**
     * One page of a backfill: reads up to `limit` rows and rewrites the derived attributes that differ from what the
     * spec computes, each only while the inputs it was computed from are unchanged. Loop until `cursor` is undefined;
     * resume from the last `cursor`. Run it once every writer derives with the current spec.
     */
    async backfillPage(opts?: {cursor?: string, limit?: number}): Promise<GGDynamoDbBackfillResult> {
        const page = await this.db.scanPage<Source>(this.tableName, {cursor: opts?.cursor, limit: opts?.limit ?? 100})
        const results = await Promise.all(page.items.map(async item => {
            const stale = this.spec.derived.filter(({name, key}) => key.compute(pick(item, key.deps)) !== item[name])
            if (stale.length === 0) return "same"
            const e = new Expr()
            const set = stale.filter(({key}) => key.compute(pick(item, key.deps)) !== undefined)
            const remove = stale.filter(d => !set.includes(d))
            const deps = [...new Set(stale.flatMap(d => d.key.deps))]
            try {
                await this.db.getDocumentClient().send(new UpdateCommand({
                    TableName: this.tableName,
                    Key: pick(item, this.keyFields()),
                    UpdateExpression: [
                        set.length > 0 && `SET ${set.map(({name, key}) => `${e.name(name)} = ${e.value(key.compute(pick(item, key.deps)))}`).join(", ")}`,
                        remove.length > 0 && `REMOVE ${remove.map(d => e.name(d.name)).join(", ")}`,
                    ].filter(Boolean).join(" "),
                    ConditionExpression: [`attribute_exists(${e.name(this.spec.pk)})`, ...deps.map(dep => e.unchanged(dep, item[dep]))].join(" AND "),
                    ExpressionAttributeNames: e.names,
                    ...e.valuesInput(),
                }))
                return "rewritten"
            } catch (err) {
                if (isConditionFailed(err)) return "conflict"
                throw err
            }
        }))
        return {
            scanned: page.items.length,
            rewritten: results.filter(r => r === "rewritten").length,
            conflicts: results.filter(r => r === "conflict").length,
            cursor: page.cursor,
        }
    }

    /** @internal */
    putParams(row: T, opts: GGDynamoDbWriteOptions<T> | undefined) {
        const item = this.spec.withDerived(this.validate(row, "put")) as Source
        const e = new Expr()
        const condition = opts?.if && e.condition(opts.if)
        return {
            TableName: this.tableName,
            Item: item,
            ...(condition && {ConditionExpression: condition, ExpressionAttributeNames: e.names, ...e.valuesInput()}),
        }
    }

    /** @internal */
    updateParams(key: GGDynamoDbTableKey<T, PK, SK>, fields: Source, opts: GGDynamoDbUpdateOptions<T> | undefined) {
        const fail = (msg: string): never => { throw new Error(`${this.tableName}.update: ${msg}`) }
        const keys = Object.keys(fields)
        for (const k of keys) {
            if (this.keyFields().includes(k)) fail(`"${k}" is part of the table key`)
            if (this.spec.derived.some(d => d.name === k)) fail(`"${k}" is derived; write its inputs instead`)
        }
        const parsed = this.spec.schema.pick(...keys as (keyof T)[]).safeParse(fields)
        if (!parsed.success) fail(`schema validation failed: ${JSON.stringify(parsed.issues)}`)
        const valid = (parsed as {value: Source}).value
        for (const k of keys) if (fields[k] !== undefined && !(k in valid)) fail(`"${k}" is not a schema field`)

        const e = new Expr()
        const conditions = opts?.upsert ? [] : [`attribute_exists(${e.name(this.spec.pk)})`]
        if (opts?.if) conditions.push(e.condition(opts.if))
        const pinned = pins(opts?.if)
        const set: string[] = []
        const remove: string[] = []
        for (const k of keys) {
            const value = this.spec.sets.has(k) && (valid[k] as unknown[] | undefined)?.length ? new Set(valid[k] as unknown[]) : valid[k]
            if (fields[k] === undefined || (this.spec.sets.has(k) && !(value instanceof Set))) remove.push(e.name(k))
            else set.push(`${e.name(k)} = ${e.value(value)}`)
        }
        const add = this.atomicOps(opts?.add, "add", keys, fail)
        const del = this.atomicOps(opts?.delete, "delete", keys, fail)
        const atomic = [...add, ...del].map(o => o.field)
        const conditionedOnCurrent = new Set<string>()
        for (const {name, key: derived} of this.spec.derived) {
            const changed = derived.deps.find(dep => atomic.includes(dep))
            if (changed) fail(`derived "${name}" reads "${changed}", which an atomic add/delete changes`)
            // An upsert may create the row, which then needs every derived attribute.
            if (!opts?.upsert && !derived.deps.some(dep => keys.includes(dep))) continue
            const src: Source = {}
            for (const dep of derived.deps) {
                if (keys.includes(dep)) src[dep] = valid[dep]
                else if (dep in pinned) src[dep] = pinned[dep]
                else if (opts?.current) {
                    src[dep] = (opts.current as Source)[dep]
                    if (!conditionedOnCurrent.has(dep)) conditions.push(e.unchanged(dep, src[dep]))
                    conditionedOnCurrent.add(dep)
                } else {
                    fail(`derived "${name}" reads "${dep}", which neither fields, an eq condition nor opts.current provides`)
                }
            }
            const value = derived.compute(src)
            if (value === undefined) remove.push(e.name(name))
            else set.push(`${e.name(name)} = ${e.value(value)}`)
        }
        if (set.length + remove.length + atomic.length === 0) fail("nothing to write")
        return {
            TableName: this.tableName,
            Key: this.tableKey(key),
            UpdateExpression: [
                set.length > 0 && `SET ${set.join(", ")}`,
                remove.length > 0 && `REMOVE ${remove.join(", ")}`,
                add.length > 0 && `ADD ${add.map(o => `${e.name(o.field)} ${e.value(o.value)}`).join(", ")}`,
                del.length > 0 && `DELETE ${del.map(o => `${e.name(o.field)} ${e.value(o.value)}`).join(", ")}`,
            ].filter(Boolean).join(" "),
            ...(conditions.length > 0 && {ConditionExpression: conditions.join(" AND ")}),
            ExpressionAttributeNames: e.names,
            ...e.valuesInput(),
        }
    }

    private atomicOps(ops: Source | undefined, op: "add" | "delete", written: string[], fail: (msg: string) => never): {field: string, value: unknown}[] {
        return Object.entries(ops ?? {}).filter(([, v]) => v !== undefined).map(([field, value]) => {
            if (written.includes(field)) fail(`"${field}" is both written and in ${op}`)
            if (this.spec.sets.has(field)) {
                const parsed = this.spec.schema.pick(field as keyof T).safeParse({[field]: value})
                if (!parsed.success || (value as unknown[]).length === 0) fail(`${op} "${field}" needs a non-empty array of its elements`)
                return {field, value: new Set(value as unknown[])}
            }
            if (op === "delete") fail(`delete "${field}" needs a field declared in the spec's sets`)
            if (this.spec.fieldType(field) === "array") fail(`add "${field}" needs the field declared in the spec's sets`)
            if (this.spec.fieldType(field) !== "number" || !Number.isFinite(value)) fail(`add "${field}" needs a number field and a number`)
            return {field, value}
        })
    }

    /** @internal */
    tableKey(key: object): Source {
        return pick(key as Source, this.keyFields())
    }

    /** @internal */
    fromStored<R>(item: Source | undefined): R | undefined {
        return item && this.spec.withoutDerived(item) as unknown as R
    }

    private keyFields(): string[] {
        return this.spec.sk ? [this.spec.pk, this.spec.sk] : [this.spec.pk]
    }

    private validate(row: T, op: string): T {
        const result = this.spec.schema.safeParse(row)
        if (!result.success) {
            throw new Error(`${this.tableName}.${op}: schema validation failed for ${String((row as Source)[this.spec.pk])}: ${JSON.stringify(result.issues)}`)
        }
        return result.value
    }
}

export class GGDynamoDbIndexQuery<T extends object, D, Row, PKA, SKA> {

    private readonly db: GGDynamoDb
    private readonly table: GGDynamoDbTypedTable<T, any, any, any, any>
    private readonly def: GGDynamoDbResolvedIndex

    constructor(db: GGDynamoDb, table: GGDynamoDbTypedTable<T, any, any, any, any>, def: GGDynamoDbResolvedIndex) {
        this.db = db
        this.table = table
        this.def = def
    }

    /** Every match, following DynamoDB's paging (capped like `GGDynamoDb.query`; `limit` bounds it). */
    async query(...[key, opts]: QueryArgs<GGDynamoDbKeyInput<T, D, PKA>, GGDynamoDbTypedQueryOptions<T, GGDynamoDbAttrValue<T, D, SKA>>>): Promise<Row[]> {
        const e = new Expr()
        const keyCondition = this.keyCondition(e, (key ?? {}) as Source, opts?.sk)
        const filter = opts?.filter && e.condition(opts.filter)
        const rows = await this.db.query<Source>(this.table.tableName, this.def.indexName, keyCondition, e.values, {
            limit: opts?.limit, descending: opts?.descending, consistentRead: (opts as GGDynamoDbConsistentReadOption)?.consistentRead, filter, names: e.names,
        })
        return rows.map(r => this.table.fromStored<Row>(r)!)
    }

    /** One page plus the cursor to continue it; `cursor` is absent on the last page. */
    async queryPage(...[key, opts]: QueryArgs<GGDynamoDbKeyInput<T, D, PKA>, GGDynamoDbTypedQueryPageOptions<GGDynamoDbAttrValue<T, D, SKA>>>): Promise<GGDynamoDbPage<Row>> {
        const e = new Expr()
        const keyCondition = this.keyCondition(e, (key ?? {}) as Source, opts?.sk)
        const page = await this.db.queryPage<Source>(this.table.tableName, this.def.indexName, keyCondition, e.values, {
            limit: opts?.limit, descending: opts?.descending, consistentRead: (opts as GGDynamoDbConsistentReadOption)?.consistentRead, cursor: opts?.cursor, names: e.names,
        })
        return {items: page.items.map(r => this.table.fromStored<Row>(r)!), cursor: page.cursor}
    }

    /** The first match, with the limit on the wire (dropped when `filter` is set). */
    async queryOne(...[key, opts]: QueryArgs<GGDynamoDbKeyInput<T, D, PKA>, Omit<GGDynamoDbTypedQueryOptions<T, GGDynamoDbAttrValue<T, D, SKA>>, "limit">>): Promise<Row | undefined> {
        return (await this.query(...[key, {...opts, limit: 1}] as any))[0]
    }

    private keyCondition(e: Expr, key: Source, sk: object | undefined): string {
        const pkValue = this.attrValue(this.def.pk, key)
        const parts = [`${e.name(this.def.pk)} = ${e.value(pkValue)}`]
        if (sk) {
            if (!this.def.sk) throw new Error(`${this.table.tableName}: ${this.def.key} has no sort key`)
            parts.push(skExpression(e, this.def.sk, sk))
        }
        return parts.join(" AND ")
    }

    private attrValue(attr: string, key: Source): unknown {
        const derived = this.table.spec.derived.find(d => d.name === attr)?.key
        if (derived) return derived.fromQuery(key, attr)
        const value = key[attr]
        if (value === undefined) throw new Error(`${this.table.tableName}: query on ${this.def.key} needs ${attr}`)
        return value
    }
}

/** Items for `GGDynamoDb.transactWrite`, built with the same validation, derivation and conditions as the table's own writes. */
export class GGDynamoDbTransactBuilder<T extends object, PK extends keyof T & string, SK extends keyof T & string | undefined> {

    private readonly table: GGDynamoDbTypedTable<T, PK, SK, any, any>

    constructor(table: GGDynamoDbTypedTable<T, PK, SK, any, any>) {
        this.table = table
    }

    put(row: T, opts?: GGDynamoDbWriteOptions<T>): GGDynamoDbTransactItem {
        return {Put: this.table.putParams(row, opts)}
    }

    update(key: GGDynamoDbTableKey<T, PK, SK>, fields: Partial<Omit<T, PK | (SK & string)>>, opts?: GGDynamoDbUpdateOptions<T>): GGDynamoDbTransactItem {
        return {Update: this.table.updateParams(key, fields as Source, opts)}
    }

    delete(key: GGDynamoDbTableKey<T, PK, SK>, opts?: GGDynamoDbWriteOptions<T>): GGDynamoDbTransactItem {
        const e = new Expr()
        const condition = opts?.if && e.condition(opts.if)
        return {Delete: {
            TableName: this.table.tableName,
            Key: this.table.tableKey(key),
            ...(condition && {ConditionExpression: condition, ExpressionAttributeNames: e.names, ...e.valuesInput()}),
        }}
    }

    check(key: GGDynamoDbTableKey<T, PK, SK>, condition: GGDynamoDbCondition<T>): GGDynamoDbTransactItem {
        const e = new Expr()
        return {ConditionCheck: {
            TableName: this.table.tableName,
            Key: this.table.tableKey(key),
            ConditionExpression: e.condition(condition),
            ExpressionAttributeNames: e.names,
            ...e.valuesInput(),
        }}
    }
}

/** Placeholders for one expression set. Every attribute goes through a name placeholder, so reserved words just work. */
class Expr {
    readonly names: Record<string, string> = {}
    readonly values: Record<string, unknown> = {}
    private readonly byName = new Map<string, string>()

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

    unchanged(attr: string, v: unknown): string {
        return v === undefined ? `attribute_not_exists(${this.name(attr)})` : `${this.name(attr)} = ${this.value(v)}`
    }

    condition(c: GGDynamoDbCondition<any>): string {
        const parts: string[] = []
        for (const [field, op] of Object.entries(c)) {
            if (op === undefined) continue
            if (field === "anyOf" || field === "allOf") {
                const nested = (op as GGDynamoDbCondition<any>[]).map(a => this.condition(a))
                if (nested.length === 0) throw new Error(`GGDynamoDb: ${field} needs at least one condition`)
                parts.push(`(${nested.join(field === "anyOf" ? " OR " : " AND ")})`)
            } else if ("eq" in op) parts.push(`${this.name(field)} = ${this.value(op.eq)}`)
            else if ("ne" in op) parts.push(`${this.name(field)} <> ${this.value(op.ne)}`)
            else parts.push(`${(op as {exists: boolean}).exists ? "attribute_exists" : "attribute_not_exists"}(${this.name(field)})`)
        }
        if (parts.length === 0) throw new Error("GGDynamoDb: empty condition")
        return parts.length === 1 ? parts[0] : `(${parts.join(" AND ")})`
    }

    valuesOrUndefined(): Record<string, unknown> | undefined {
        return Object.keys(this.values).length > 0 ? this.values : undefined
    }

    valuesInput(): {ExpressionAttributeValues?: Record<string, unknown>} {
        return Object.keys(this.values).length > 0 ? {ExpressionAttributeValues: this.values} : {}
    }
}

function skExpression(e: Expr, attr: string, c: Record<string, any>): string {
    const n = e.name(attr)
    if ("eq" in c) return `${n} = ${e.value(c.eq)}`
    if ("lt" in c) return `${n} < ${e.value(c.lt)}`
    if ("lte" in c) return `${n} <= ${e.value(c.lte)}`
    if ("gt" in c) return `${n} > ${e.value(c.gt)}`
    if ("gte" in c) return `${n} >= ${e.value(c.gte)}`
    if ("between" in c) return `${n} BETWEEN ${e.value(c.between[0])} AND ${e.value(c.between[1])}`
    return `begins_with(${n}, ${e.value(c.beginsWith)})`
}

/** Values a condition proves the row holds: top-level `eq`, and `exists: false` as undefined. */
function pins(c: GGDynamoDbCondition<any> | undefined): Source {
    const out: Source = {}
    for (const [field, op] of Object.entries(c ?? {})) {
        if (field === "allOf") Object.assign(out, ...(op as GGDynamoDbCondition<any>[]).map(pins))
        if (field === "anyOf" || field === "allOf" || !op) continue
        if ("eq" in op) out[field] = op.eq
        else if ("exists" in op && op.exists === false) out[field] = undefined
    }
    return out
}

function pick(row: Source, fields: readonly string[]): Source {
    return Object.fromEntries(fields.map(f => [f, row[f]]))
}

function isConditionFailed(err: unknown): boolean {
    return (err as {name?: string}).name === "ConditionalCheckFailedException"
}
