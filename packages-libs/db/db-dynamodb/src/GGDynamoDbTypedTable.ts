import {BatchGetCommand, BatchWriteCommand, UpdateCommand, type BatchGetCommandOutput, type BatchWriteCommandOutput} from "@aws-sdk/lib-dynamodb"
import type {GGSchema} from "@grest-ts/schema"
import type {GGDynamoDb, GGDynamoDbPage, GGDynamoDbTransactItem} from "./GGDynamoDb"
import {GGDynamoDbExpr, conditionFields, conditionPins, type GGDynamoDbCondition} from "./GGDynamoDbExpression"
import {GGDynamoDbJoinKey} from "./GGDynamoDbTableSpec"
import type {
    GGDynamoDbArrayFields, GGDynamoDbDerivedMap, GGDynamoDbIndexDef, GGDynamoDbIndexRow, GGDynamoDbKeyFields, GGDynamoDbKeyInput,
    GGDynamoDbMapFields, GGDynamoDbNumberFields, GGDynamoDbResolvedIndex, GGDynamoDbSkCondition, GGDynamoDbTableKey, GGDynamoDbTableSpec,
} from "./GGDynamoDbTableSpec"

type Source = Record<string, unknown>

export interface GGDynamoDbTypedQueryPageOptions<T, D, SKA> {
    sk?: [SKA] extends [never] ? never : GGDynamoDbSkCondition<T, D, SKA>
    limit?: number
    /** Walk the sort key backwards. */
    descending?: boolean
    cursor?: string
}

/** The table's own key and local indexes only: a GSI is always eventually consistent. */
export interface GGDynamoDbConsistentReadOption {
    consistentRead?: boolean
}

type ConsistentRead<Local> = Local extends true ? GGDynamoDbConsistentReadOption : {}

export interface GGDynamoDbTypedQueryOptions<T, D, SKA, PKA = never> extends Omit<GGDynamoDbTypedQueryPageOptions<T, D, SKA>, "cursor"> {
    /** Applied after the read: filtered-out rows are still read and billed. Can't read the queried key's attributes. Not
     *  on `queryPage`, where DynamoDB's Limit counts rows before the filter and a page would come back short or empty
     *  while matches remain. */
    filter?: GGDynamoDbCondition<Omit<T, (PKA | SKA) & keyof T>>
}

export interface GGDynamoDbWriteOptions<T> {
    if?: GGDynamoDbCondition<T>
}

// The other fields as `never`: an empty mapped type would be `{}`, which takes any object.
type Only<T, K extends keyof T, Partial = false> =
    {[F in K]?: Partial extends true ? {[P in keyof NonNullable<T[F]>]?: NonNullable<T[F]>[P]} : NonNullable<T[F]>}
    & {[F in Exclude<keyof T, K>]?: never}

export interface GGDynamoDbUpdateOptions<T, KF extends keyof T = never, S extends string = never> extends GGDynamoDbWriteOptions<T> {
    /** The row the caller read. Supplies a derived key's inputs `fields` leaves out, and the write then only lands
     *  while those still hold. */
    current?: T
    /** Atomic: adds to a number field (from 0 when absent; negative subtracts), or elements to a `sets` field. */
    add?: Only<T, Exclude<GGDynamoDbNumberFields<T> | (S & keyof T), KF>>
    /** Atomic: removes elements from a `sets` field; DynamoDB drops the attribute once the set is empty. */
    delete?: Only<T, Exclude<S & keyof T, KF>>
    /** Set fields only where the row has none (`if_not_exists`), e.g. a `createdAt` on an upsert. */
    setIfMissing?: Partial<Omit<T, KF>>
    /** Atomic: appends elements to a list field, creating it when absent. */
    append?: Only<T, Exclude<GGDynamoDbArrayFields<T>, S | KF>>
    /** Set keys inside a map field, leaving its other keys; a key given as `undefined` is removed. Throws when the row
     *  has no such map. */
    merge?: Only<T, Exclude<GGDynamoDbMapFields<T>, KF>, true>
    /** Create the row when it doesn't exist, instead of returning undefined: with its key, the key's inputs and what
     *  this update writes, which must cover every required field. Writes every derived attribute, so all their inputs
     *  must be known as for a touched one. Can't take `current`. */
    upsert?: boolean
}

export interface GGDynamoDbBackfillOptions {
    cursor?: string
    /** Rows read per page. Default 100. */
    limit?: number
    /** Rewrites in flight at once. Default 10. */
    concurrency?: number
    /** A parallel backfill: each worker walks segment `segment` of `totalSegments`, with its own cursor. */
    segment?: number
    totalSegments?: number
}

export interface GGDynamoDbBackfillResult {
    scanned: number
    rewritten: number
    /** Rows changed by another writer between the read and the rewrite; that writer derived their keys. */
    conflicts: number
    /** Rows whose derived attributes couldn't be computed (a key function threw): left as they are. */
    failed: {key: Source, error: string}[]
    /** Absent once the table (or segment) is done. */
    cursor: string | undefined
}

/** The bound table type for a spec: `private readonly users: GGDynamoDbTableOf<typeof UsersTable>`. */
export type GGDynamoDbTableOf<Spec> = Spec extends GGDynamoDbTableSpec<infer T, infer PK, infer SK, infer D, infer I, infer S> ? GGDynamoDbTypedTable<T, PK, SK, D, I, S> : never

type QueryArgs<K, O> = {} extends K ? [key?: K, opts?: O] : [key: K, opts?: O]

type Key<T, D, PK, SK> = GGDynamoDbTableKey<T, D, PK, SK>
type KeyFields<T, D, PK, SK> = GGDynamoDbKeyFields<T, D, PK, SK>
type Writable<T, D, PK, SK> = Partial<Omit<T, KeyFields<T, D, PK, SK>>>

const BATCH_GET_MAX_KEYS = 100
const BATCH_WRITE_MAX_ITEMS = 25
const BATCH_MAX_ATTEMPTS = 8
const BATCH_FIRST_RETRY_MS = 50

/**
 * A `GGDynamoDbTableSpec` bound to a connection. Every write computes the spec's derived attributes; every read strips
 * them. Queries go through `index.<name>` with key parts and sort-key conditions typed from the spec.
 */
export class GGDynamoDbTypedTable<
    T extends object,
    PK extends string,
    SK extends string | undefined,
    D extends GGDynamoDbDerivedMap,
    I extends Record<string, GGDynamoDbIndexDef>,
    S extends string = never,
> {

    public readonly index: {[K in keyof I]: GGDynamoDbIndexQuery<T, D, GGDynamoDbIndexRow<T, D, PK, SK, I[K]>, I[K]["pk"], I[K] extends {sk: infer X} ? X : never, I[K] extends {local: true} ? true : false>}
    public readonly tx: GGDynamoDbTransactBuilder<T, D, PK, SK, S>
    public readonly spec: GGDynamoDbTableSpec<T, PK, SK, D, I, S>
    private readonly db: GGDynamoDb
    private readonly base: GGDynamoDbIndexQuery<T, D, T, PK, SK, true>

    constructor(db: GGDynamoDb, spec: GGDynamoDbTableSpec<T, PK, SK, D, I, S>) {
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
    async get(key: Key<T, D, PK, SK>, opts?: GGDynamoDbConsistentReadOption): Promise<T | undefined> {
        return this.fromStored(await this.db.get<Source>(this.tableName, this.tableKey(key), opts))
    }

    /** The rows for `keys`, in their order, missing ones skipped and repeated keys read once. Eventually consistent by
     *  default. */
    async getMany(keys: Key<T, D, PK, SK>[], opts?: GGDynamoDbConsistentReadOption): Promise<T[]> {
        const wanted = uniqueBy(keys.map(k => this.tableKey(k)), k => this.keyId(k))
        const found = new Map<string, T>()
        for (let i = 0; i < wanted.length; i += BATCH_GET_MAX_KEYS) {
            await this.batch("getMany", wanted.slice(i, i + BATCH_GET_MAX_KEYS), async pending => {
                const res: BatchGetCommandOutput = await this.db.getDocumentClient().send(new BatchGetCommand({
                    RequestItems: {[this.tableName]: {Keys: pending, ...(opts?.consistentRead && {ConsistentRead: true})}},
                }))
                for (const item of res.Responses?.[this.tableName] ?? []) found.set(this.keyId(item), this.fromStored<T>(item)!)
                return res.UnprocessedKeys?.[this.tableName]?.Keys
            })
        }
        return wanted.flatMap(k => found.get(this.keyId(k)) ?? [])
    }

    query(...args: QueryArgs<GGDynamoDbKeyInput<T, D, PK>, GGDynamoDbTypedQueryOptions<T, D, SK extends string ? SK : never, PK> & GGDynamoDbConsistentReadOption>): Promise<T[]> {
        return this.base.query(...args as [any, any])
    }

    queryPage(...args: QueryArgs<GGDynamoDbKeyInput<T, D, PK>, GGDynamoDbTypedQueryPageOptions<T, D, SK extends string ? SK : never> & GGDynamoDbConsistentReadOption>): Promise<GGDynamoDbPage<T>> {
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

    /** `put` for many rows, 25 per request, unconditionally (DynamoDB's batch write takes no conditions) and not
     *  atomically: on an error some rows may be written. Of rows with the same key the last is written. */
    async putMany(rows: T[]): Promise<void> {
        const items = uniqueBy(rows.map(r => this.putParams(r, undefined).Item).reverse(), item => this.keyId(item)).reverse()
        await this.batchWrite(items.map(Item => ({PutRequest: {Item}})))
    }

    /** `delete` for many keys, 25 per request, unconditionally and not atomically. */
    async deleteMany(keys: Key<T, D, PK, SK>[]): Promise<void> {
        const unique = uniqueBy(keys.map(k => this.tableKey(k)), k => this.keyId(k))
        await this.batchWrite(unique.map(Key => ({DeleteRequest: {Key}})))
    }

    /**
     * Sets `fields` on an existing row; a field given as `undefined` is removed. Derived attributes whose inputs `fields`
     * touches are rewritten in the same write, from inputs the write proves: `fields`, the key, an `eq` / `exists: false`
     * in `opts.if`, or `opts.current` (then conditioned on). Throws when an input is none of those, or is changed by
     * `opts.add` / `delete` / `setIfMissing` / `append` / `merge`, whose result the write can't know. The table key's
     * fields can't be written.
     * Returns the updated row, or undefined when it doesn't exist (unless `opts.upsert`), `opts.if` fails, or an input
     * taken from `opts.current` has changed: re-read and retry.
     */
    async update(key: Key<T, D, PK, SK>, fields: Writable<T, D, PK, SK>, opts?: GGDynamoDbUpdateOptions<T, KeyFields<T, D, PK, SK>, S>): Promise<T | undefined> {
        try {
            const res = await this.db.getDocumentClient().send(new UpdateCommand({...this.updateParams(key, fields as Source, opts), ReturnValues: "ALL_NEW"}))
            return this.fromStored(res.Attributes)
        } catch (err) {
            if (isConditionFailed(err)) return undefined
            if (opts?.merge && (err as {name?: string}).name === "ValidationException" && /document path/i.test(String((err as Error).message))) {
                throw new Error(`${this.tableName}.update: merge into ${Object.keys(opts.merge).join(", ")}, which the row doesn't have`, {cause: err})
            }
            throw err
        }
    }

    /** False when `opts.if` fails. */
    async delete(key: Key<T, D, PK, SK>, opts?: GGDynamoDbWriteOptions<T>): Promise<boolean> {
        const k = this.tableKey(key)
        if (!opts?.if) {
            await this.db.delete(this.tableName, k)
            return true
        }
        const e = new GGDynamoDbExpr(this.spec.sets)
        const condition = e.condition(opts.if)
        return this.db.deleteConditional(this.tableName, k, condition, e.valuesInput().ExpressionAttributeValues, e.names)
    }

    /** Every row (capped like `GGDynamoDb.scan`). `filter` trims what comes back, not what is read. */
    async scan(opts?: {filter?: GGDynamoDbCondition<T>, limit?: number, consistentRead?: boolean}): Promise<T[]> {
        const e = new GGDynamoDbExpr(this.spec.sets)
        const filter = opts?.filter && e.condition(opts.filter)
        const rows = await this.db.scan<Source>(this.tableName, {limit: opts?.limit, consistentRead: opts?.consistentRead, filter, names: e.names, values: e.values})
        return rows.map(r => this.fromStored<T>(r)!)
    }

    /** One page of a scan; `segment` / `totalSegments` split it across parallel workers. */
    async scanPage(opts?: {limit?: number, cursor?: string, consistentRead?: boolean, segment?: number, totalSegments?: number}): Promise<GGDynamoDbPage<T>> {
        const page = await this.db.scanPage<Source>(this.tableName, opts)
        return {items: page.items.map(r => this.fromStored<T>(r)!), cursor: page.cursor}
    }

    /**
     * One page of a backfill: reads up to `limit` rows and rewrites the derived attributes that differ from what the
     * spec computes, each only while the inputs it was computed from are unchanged. Loop until `cursor` is undefined;
     * resume from the last `cursor`. Run it once every writer derives with the current spec. A DynamoDB error fails the
     * page; rewriting it again is harmless.
     */
    async backfillPage(opts?: GGDynamoDbBackfillOptions): Promise<GGDynamoDbBackfillResult> {
        const page = await this.db.scanPage<Source>(this.tableName, {
            cursor: opts?.cursor, limit: opts?.limit ?? 100, segment: opts?.segment, totalSegments: opts?.totalSegments,
        })
        const failed: GGDynamoDbBackfillResult["failed"] = []
        const results = await mapLimit(page.items, opts?.concurrency ?? 10, async item => {
            let computed: {name: string, deps: readonly string[], value: unknown}[]
            try {
                // A key attribute is the row's address: a different value would be another row.
                computed = this.spec.derived
                    .filter(d => !this.spec.keyAttributes.includes(d.name))
                    .map(({name, key}) => ({name, deps: key.deps, value: key.compute(item)}))
            } catch (err) {
                failed.push({key: pick(item, this.spec.keyAttributes), error: err instanceof Error ? err.message : String(err)})
                return "failed"
            }
            const stale = computed.filter(d => d.value !== item[d.name])
            if (stale.length === 0) return "same"
            const e = new GGDynamoDbExpr(this.spec.sets)
            const set = stale.filter(d => d.value !== undefined)
            const remove = stale.filter(d => d.value === undefined)
            const deps = [...new Set(stale.flatMap(d => d.deps))]
            try {
                await this.db.getDocumentClient().send(new UpdateCommand({
                    TableName: this.tableName,
                    Key: pick(item, this.spec.keyAttributes),
                    UpdateExpression: [
                        set.length > 0 && `SET ${set.map(d => `${e.name(d.name)} = ${e.value(d.value)}`).join(", ")}`,
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
        })
        return {
            scanned: page.items.length,
            rewritten: results.filter(r => r === "rewritten").length,
            conflicts: results.filter(r => r === "conflict").length,
            failed,
            cursor: page.cursor,
        }
    }

    /** @internal */
    putParams(row: T, opts: GGDynamoDbWriteOptions<T> | undefined) {
        const item = this.spec.withDerived(this.validate(row, "put")) as Source
        const e = new GGDynamoDbExpr(this.spec.sets)
        const condition = opts?.if && e.condition(opts.if)
        return {
            TableName: this.tableName,
            Item: item,
            ...(condition && {ConditionExpression: condition, ExpressionAttributeNames: e.names, ...e.valuesInput()}),
        }
    }

    /** @internal */
    updateParams(key: Key<T, D, PK, SK>, fields: Source, opts: GGDynamoDbUpdateOptions<T, any, any> | undefined) {
        const fail = (msg: string): never => { throw new Error(`${this.tableName}.update: ${msg}`) }
        const {spec} = this
        const keys = Object.keys(fields)
        for (const k of keys) {
            if (spec.keyFields.includes(k)) fail(`"${k}" is part of the table key`)
            if (spec.derived.some(d => d.name === k)) fail(`"${k}" is derived; write its inputs instead`)
        }
        if (opts?.upsert && opts.current) fail("an upsert can't take current: a row it creates holds none of it")
        const valid = this.validFields(fields, fail)
        const e = new GGDynamoDbExpr(spec.sets)
        const storedKey = spec.storedKey(key as Source)
        const keyInputs = pick(key as Source, spec.keyFields)

        // A `string` / `number` table key may map several inputs to one value, so the inputs it was given are checked.
        const keyChecks = spec.keyAttributes
            .filter(a => spec.derivedKey(a)?.kind === "value")
            .flatMap(a => spec.derivedKey(a)!.deps)
            .map(dep => e.unchanged(dep, keyInputs[dep]))
        const conditions: string[] = opts?.upsert
            ? keyChecks.length > 0 ? [`(attribute_not_exists(${e.name(spec.pk)}) OR (${keyChecks.join(" AND ")}))`] : []
            : [`attribute_exists(${e.name(spec.pk)})`, ...keyChecks]
        if (opts?.if) conditions.push(e.condition(opts.if))
        const known: Source = {...conditionPins(opts?.if), ...keyInputs}

        const set: string[] = []
        const remove: string[] = []
        for (const k of keys) {
            const value = this.asStored(k, valid[k])
            if (value === undefined) remove.push(e.name(k))
            else set.push(`${e.name(k)} = ${e.value(value)}`)
        }
        if (opts?.upsert) {
            for (const [k, v] of Object.entries(keyInputs)) if (!spec.keyAttributes.includes(k)) set.push(`${e.name(k)} = ${e.value(v)}`)
        }

        const touched = new Set(keys)
        const claim = (field: string, op: string) => {
            if (spec.keyFields.includes(field)) fail(`${op} "${field}": it is part of the table key`)
            if (touched.has(field)) fail(`"${field}" is written twice (${op})`)
            touched.add(field)
        }
        const add = this.atomicOps(opts?.add, "add", fail)
        const del = this.atomicOps(opts?.delete, "delete", fail)
        for (const o of [...add, ...del]) claim(o.field, o.op)
        for (const [field, value] of definedEntries(opts?.setIfMissing)) {
            claim(field, "setIfMissing")
            const stored = this.asStored(field, this.validFields({[field]: value}, fail)[field])
            if (stored === undefined) fail(`setIfMissing "${field}" needs a value`)
            set.push(`${e.name(field)} = if_not_exists(${e.name(field)}, ${e.value(stored)})`)
        }
        for (const [field, value] of definedEntries(opts?.append)) {
            claim(field, "append")
            if (spec.sets.has(field)) fail(`append "${field}": a set takes add`)
            if (spec.fieldType(field) !== "array" || (value as unknown[]).length === 0) fail(`append "${field}" needs a list field and a non-empty array`)
            const elements = this.validFields({[field]: value}, fail)[field]
            set.push(`${e.name(field)} = list_append(if_not_exists(${e.name(field)}, ${e.value([])}), ${e.value(elements)})`)
        }
        for (const [field, entries] of definedEntries(opts?.merge)) {
            claim(field, "merge")
            for (const [k, v] of Object.entries(this.validMapEntries(field, entries as Source, fail))) {
                if (v === undefined) remove.push(`${e.name(field)}.${e.name(k)}`)
                else set.push(`${e.name(field)}.${e.name(k)} = ${e.value(v)}`)
            }
        }
        const opaque = [...touched].filter(f => !keys.includes(f))

        if (opts?.upsert) {
            const covered = new Set([...keys.filter(k => fields[k] !== undefined), ...Object.keys(keyInputs), ...opaque.filter(f => !del.some(o => o.field === f))])
            const missing = spec.requiredFields().filter(f => !covered.has(f))
            if (missing.length > 0) fail(`an upsert may create the row, which then needs ${missing.join(", ")}: give them in fields, setIfMissing or add`)
        }

        const conditionedOnCurrent = new Set<string>()
        for (const {name, key: derived} of spec.derived) {
            if (spec.keyAttributes.includes(name)) continue
            const changed = derived.deps.find(dep => opaque.includes(dep))
            if (changed) fail(`derived "${name}" reads "${changed}", which this update changes to a value it can't know`)
            // An upsert may create the row, which then needs every derived attribute.
            if (!opts?.upsert && !derived.deps.some(dep => keys.includes(dep))) continue
            const src: Source = {}
            for (const dep of derived.deps) {
                if (keys.includes(dep)) src[dep] = valid[dep]
                else if (dep in known) src[dep] = known[dep]
                else if (opts?.current) {
                    src[dep] = (opts.current as Source)[dep]
                    if (!conditionedOnCurrent.has(dep)) conditions.push(e.unchanged(dep, src[dep]))
                    conditionedOnCurrent.add(dep)
                } else {
                    fail(`derived "${name}" reads "${dep}", which neither fields, an eq condition, the key nor opts.current provides`)
                }
            }
            const value = derived.compute(src)
            if (value === undefined) remove.push(e.name(name))
            else set.push(`${e.name(name)} = ${e.value(value)}`)
        }
        if (set.length + remove.length + add.length + del.length === 0) fail("nothing to write")
        return {
            TableName: this.tableName,
            Key: storedKey,
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

    /** @internal */
    tableKey(key: object): Source {
        return this.spec.storedKey(key as Source)
    }

    /** @internal */
    fromStored<R>(item: Source | undefined): R | undefined {
        return item && this.spec.withoutDerived(item) as unknown as R
    }

    // A `sets` field is stored as a set, and as no attribute when empty.
    private asStored(field: string, value: unknown): unknown {
        if (!this.spec.sets.has(field) || value === undefined) return value
        return (value as unknown[]).length > 0 ? new Set(value as unknown[]) : undefined
    }

    private keyId(item: Source): string {
        return JSON.stringify(this.spec.keyAttributes.map(a => item[a]))
    }

    private async batchWrite(requests: object[]): Promise<void> {
        for (let i = 0; i < requests.length; i += BATCH_WRITE_MAX_ITEMS) {
            await this.batch("batch write", requests.slice(i, i + BATCH_WRITE_MAX_ITEMS), async pending => {
                const res: BatchWriteCommandOutput = await this.db.getDocumentClient().send(new BatchWriteCommand({RequestItems: {[this.tableName]: pending as any}}))
                return res.UnprocessedItems?.[this.tableName]
            })
        }
    }

    // DynamoDB hands back what it throttled as unprocessed, to be resent after a backoff.
    private async batch<R>(op: string, requests: R[], send: (pending: R[]) => Promise<R[] | undefined>): Promise<void> {
        let pending: R[] | undefined = requests
        for (let attempt = 0; pending && pending.length > 0; attempt++) {
            if (attempt === BATCH_MAX_ATTEMPTS) throw new Error(`${this.tableName}.${op}: ${pending.length} item(s) still unprocessed after ${attempt} attempts`)
            if (attempt > 0) await new Promise(r => setTimeout(r, Math.random() * BATCH_FIRST_RETRY_MS * 2 ** (attempt - 1)))
            pending = await send(pending)
        }
    }

    private validate(row: T, op: string): T {
        const result = this.spec.schema.safeParse(row)
        if (!result.success) {
            throw new Error(`${this.tableName}.${op}: schema validation failed for ${JSON.stringify(pick(row as Source, this.spec.keyFields))}: ${JSON.stringify(result.issues)}`)
        }
        return result.value
    }

    private validFields(fields: Source, fail: (msg: string) => never): Source {
        const keys = Object.keys(fields)
        const parsed = this.spec.schema.pick(...keys as (keyof T)[]).safeParse(fields)
        if (!parsed.success) fail(`schema validation failed: ${JSON.stringify(parsed.issues)}`)
        const valid = (parsed as {value: Source}).value
        for (const k of keys) if (fields[k] !== undefined && !(k in valid)) fail(`"${k}" is not a schema field`)
        return valid
    }

    private validMapEntries(field: string, entries: Source, fail: (msg: string) => never): Source {
        const def = this.spec.fieldSchema(field)?.toCompilerDef() as {type: string, shape?: Record<string, GGSchema<unknown>>, value?: GGSchema<unknown>} | undefined
        if (def?.type !== "object" && def?.type !== "record") fail(`merge "${field}": it is not a map field`)
        if (Object.keys(entries).length === 0) fail(`merge "${field}" needs at least one key`)
        return Object.fromEntries(Object.entries(entries).map(([k, v]) => {
            const schema = def!.type === "object" ? def!.shape?.[k] : def!.value
            if (!schema) fail(`merge "${field}": "${k}" is not one of its keys`)
            if (v === undefined) return [k, undefined]
            const parsed = schema!.safeParse(v)
            if (!parsed.success) fail(`merge "${field}.${k}": schema validation failed: ${JSON.stringify(parsed.issues)}`)
            return [k, (parsed as {value: unknown}).value]
        }))
    }

    private atomicOps(ops: object | undefined, op: "add" | "delete", fail: (msg: string) => never): {field: string, op: string, value: unknown}[] {
        return definedEntries(ops).map(([field, value]) => {
            if (this.spec.sets.has(field)) {
                const parsed = this.spec.schema.pick(field as keyof T).safeParse({[field]: value})
                if (!parsed.success || (value as unknown[]).length === 0) fail(`${op} "${field}" needs a non-empty array of its elements`)
                return {field, op, value: new Set(value as unknown[])}
            }
            if (op === "delete") fail(`delete "${field}" needs a field declared in the spec's sets`)
            if (this.spec.fieldType(field) === "array") fail(`add "${field}" needs the field declared in the spec's sets`)
            if (this.spec.fieldType(field) !== "number" || !Number.isFinite(value)) fail(`add "${field}" needs a number field and a number`)
            return {field, op, value}
        })
    }
}

export class GGDynamoDbIndexQuery<T extends object, D, Row, PKA, SKA, Local = false> {

    private readonly db: GGDynamoDb
    private readonly table: GGDynamoDbTypedTable<T, any, any, any, any, any>
    private readonly def: GGDynamoDbResolvedIndex

    constructor(db: GGDynamoDb, table: GGDynamoDbTypedTable<T, any, any, any, any, any>, def: GGDynamoDbResolvedIndex) {
        this.db = db
        this.table = table
        this.def = def
    }

    /** Every match, following DynamoDB's paging (capped like `GGDynamoDb.query`; `limit` bounds it). */
    async query(...[key, opts]: QueryArgs<GGDynamoDbKeyInput<T, D, PKA>, GGDynamoDbTypedQueryOptions<T, D, SKA, PKA> & ConsistentRead<Local>>): Promise<Row[]> {
        const e = new GGDynamoDbExpr(this.table.spec.sets)
        const keyCondition = this.keyCondition(e, (key ?? {}) as Source, opts?.sk)
        if (opts?.filter) {
            const keyRead = conditionFields(opts.filter).find(f => f === this.def.pk || f === this.def.sk)
            if (keyRead) throw new Error(`${this.table.tableName}: a filter can't read "${keyRead}", a key of ${this.def.key}; use sk`)
        }
        const filter = opts?.filter && e.condition(opts.filter)
        const rows = await this.db.query<Source>(this.table.tableName, this.def.indexName, keyCondition, e.values, {
            limit: opts?.limit, descending: opts?.descending, consistentRead: (opts as GGDynamoDbConsistentReadOption)?.consistentRead, filter, names: e.names,
        })
        return rows.map(r => this.table.fromStored<Row>(r)!)
    }

    /** One page plus the cursor to continue it; `cursor` is absent on the last page. A cursor from another query
     *  throws `GGDynamoDbCursorError`. */
    async queryPage(...[key, opts]: QueryArgs<GGDynamoDbKeyInput<T, D, PKA>, GGDynamoDbTypedQueryPageOptions<T, D, SKA> & ConsistentRead<Local>>): Promise<GGDynamoDbPage<Row>> {
        const e = new GGDynamoDbExpr(this.table.spec.sets)
        const keyCondition = this.keyCondition(e, (key ?? {}) as Source, opts?.sk)
        const page = await this.db.queryPage<Source>(this.table.tableName, this.def.indexName, keyCondition, e.values, {
            limit: opts?.limit, descending: opts?.descending, consistentRead: (opts as GGDynamoDbConsistentReadOption)?.consistentRead, cursor: opts?.cursor, names: e.names,
        })
        return {items: page.items.map(r => this.table.fromStored<Row>(r)!), cursor: page.cursor}
    }

    /** The first match, with the limit on the wire (dropped when `filter` is set). */
    async queryOne(...[key, opts]: QueryArgs<GGDynamoDbKeyInput<T, D, PKA>, Omit<GGDynamoDbTypedQueryOptions<T, D, SKA, PKA>, "limit"> & ConsistentRead<Local>>): Promise<Row | undefined> {
        return (await this.query(...[key, {...opts, limit: 1}] as any))[0]
    }

    private keyCondition(e: GGDynamoDbExpr, key: Source, sk: object | undefined): string {
        const parts = [`${e.name(this.def.pk)} = ${e.value(this.attrValue(this.def.pk, key))}`]
        if (sk) {
            if (!this.def.sk) throw new Error(`${this.table.tableName}: ${this.def.key} has no sort key`)
            const sortKey = this.def.sk
            const derived = this.table.spec.derivedKey(sortKey)
            let condition = sk as Source
            if ("prefix" in condition) {
                if (!(derived instanceof GGDynamoDbJoinKey)) throw new Error(`${this.table.tableName}: prefix needs a join sort key`)
                condition = derived.prefixCondition(condition.prefix as Source)
            }
            parts.push(e.range(e.name(sortKey), condition, v => derived && isPlainObject(v) ? derived.fromQuery(v, sortKey) : v))
        }
        return parts.join(" AND ")
    }

    private attrValue(attr: string, key: Source): unknown {
        const derived = this.table.spec.derivedKey(attr)
        if (derived) return derived.fromQuery(key, attr)
        const value = key[attr]
        if (value === undefined) throw new Error(`${this.table.tableName}: query on ${this.def.key} needs ${attr}`)
        return value
    }
}

/** Items for `GGDynamoDb.transactWrite`, built with the same validation, derivation and conditions as the table's own writes. */
export class GGDynamoDbTransactBuilder<T extends object, D extends GGDynamoDbDerivedMap, PK extends string, SK extends string | undefined, S extends string = never> {

    private readonly table: GGDynamoDbTypedTable<T, PK, SK, D, any, S>

    constructor(table: GGDynamoDbTypedTable<T, PK, SK, D, any, S>) {
        this.table = table
    }

    put(row: T, opts?: GGDynamoDbWriteOptions<T>): GGDynamoDbTransactItem {
        return {Put: this.table.putParams(row, opts)}
    }

    update(key: Key<T, D, PK, SK>, fields: Writable<T, D, PK, SK>, opts?: GGDynamoDbUpdateOptions<T, KeyFields<T, D, PK, SK>, S>): GGDynamoDbTransactItem {
        return {Update: this.table.updateParams(key, fields as Source, opts)}
    }

    delete(key: Key<T, D, PK, SK>, opts?: GGDynamoDbWriteOptions<T>): GGDynamoDbTransactItem {
        const e = new GGDynamoDbExpr(this.table.spec.sets)
        const condition = opts?.if && e.condition(opts.if)
        return {Delete: {
            TableName: this.table.tableName,
            Key: this.table.tableKey(key),
            ...(condition && {ConditionExpression: condition, ExpressionAttributeNames: e.names, ...e.valuesInput()}),
        }}
    }

    check(key: Key<T, D, PK, SK>, condition: GGDynamoDbCondition<T>): GGDynamoDbTransactItem {
        const e = new GGDynamoDbExpr(this.table.spec.sets)
        return {ConditionCheck: {
            TableName: this.table.tableName,
            Key: this.table.tableKey(key),
            ConditionExpression: e.condition(condition),
            ExpressionAttributeNames: e.names,
            ...e.valuesInput(),
        }}
    }
}

async function mapLimit<A, R>(items: A[], limit: number, fn: (item: A) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let next = 0
    await Promise.all(Array.from({length: Math.min(Math.max(limit, 1), items.length)}, async () => {
        while (next < items.length) {
            const i = next++
            results[i] = await fn(items[i])
        }
    }))
    return results
}

function uniqueBy<A>(items: A[], id: (item: A) => string): A[] {
    const seen = new Set<string>()
    return items.filter(item => !seen.has(id(item)) && !!seen.add(id(item)))
}

function isPlainObject(v: unknown): v is Source {
    return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Set)
}

function definedEntries(o: object | undefined): [string, unknown][] {
    return Object.entries(o ?? {}).filter(([, v]) => v !== undefined)
}

function pick(row: Source, fields: readonly string[]): Source {
    return Object.fromEntries(fields.map(f => [f, row[f]]))
}

function isConditionFailed(err: unknown): boolean {
    return (err as {name?: string}).name === "ConditionalCheckFailedException"
}
