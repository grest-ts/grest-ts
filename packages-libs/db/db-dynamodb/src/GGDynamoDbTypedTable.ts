import {BatchGetCommand, BatchWriteCommand, DeleteCommand, UpdateCommand, type BatchGetCommandOutput, type BatchWriteCommandOutput} from "@aws-sdk/lib-dynamodb"
import type {GGSchema} from "@grest-ts/schema"
import type {GGDynamoDb, GGDynamoDbPage, GGDynamoDbTransactItem} from "./GGDynamoDb"
import {GGDynamoDbExpr, conditionFields, conditionPins, type GGDynamoDbCondition} from "./GGDynamoDbExpression"
import {GGDynamoDbJoinKey} from "./GGDynamoDbTableSpec"
import type {
    GGDynamoDbArrayFields, GGDynamoDbDerivedMap, GGDynamoDbFlat, GGDynamoDbIndexDef, GGDynamoDbIndexRow, GGDynamoDbKeyFields, GGDynamoDbKeyInput,
    GGDynamoDbMapFields, GGDynamoDbNumberFields, GGDynamoDbResolvedIndex, GGDynamoDbRow, GGDynamoDbSkCondition, GGDynamoDbTableKey, GGDynamoDbTableSpec,
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
    /** Leave fields given as `undefined` as they are, instead of removing them. */
    skipUndefined?: boolean
    /** On a table with a spec `version`: write only while the stored version is this (0 also matches a row without one). */
    expectVersion?: number
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
    /** Rows the schema doesn't accept, such as another spec's on a shared table: left as they are. */
    skipped: number
    /** Rows whose derived attributes couldn't be computed (a key function threw): left as they are. */
    failed: {key: Source, error: string}[]
    /** Absent once the table (or segment) is done. */
    cursor: string | undefined
}

/** The bound table type for a spec: `private readonly users: GGDynamoDbTableOf<typeof UsersTable>`. */
export type GGDynamoDbTableOf<Spec> = Spec extends GGDynamoDbTableSpec<infer T, infer PK, infer SK, infer D, infer I, infer S> ? GGDynamoDbTypedTable<T, PK, SK, D, I, S> : never

export interface GGDynamoDbTableOptions {
    /** The physical table, when not the spec's `name` (`spec.withName`). */
    name?: string
}

type QueryArgs<K, O> = {} extends K ? [key?: K, opts?: O] : [key: K, opts?: O]

/** A row's address: the key object, or for a table keyed on one plain field, that field's bare value. */
type Key<T, D, PK, SK> = GGDynamoDbTableKey<T, D, PK, SK> | ([SK] extends [undefined] ? PK extends keyof D ? never : PK extends keyof T ? NonNullable<T[PK]> : never : never)
type KeyFields<T, D, PK, SK> = GGDynamoDbKeyFields<T, D, PK, SK>
type Writable<T, D, PK, SK> = Partial<Omit<T, KeyFields<T, D, PK, SK>>>
// A union row's fields one by one: what keys, conditions and updates are typed against.
type Flat<T> = GGDynamoDbFlat<T>

const BATCH_GET_MAX_KEYS = 100
const BATCH_WRITE_MAX_ITEMS = 25
const BATCH_CONCURRENCY = 4
const BATCH_MAX_ATTEMPTS = 8
const BATCH_FIRST_RETRY_MS = 50

/**
 * A `GGDynamoDbTableSpec` bound to a connection. Every write computes the spec's derived attributes; every read returns
 * the schema's shape (`spec.toRow`). Queries go through `index.<name>` with key parts and sort-key conditions typed
 * from the spec. Extend `GGDynamoDbTypedTable.of(spec)` to add a store's own methods.
 */
export class GGDynamoDbTypedTable<
    T extends object,
    PK extends string,
    SK extends string | undefined,
    D extends GGDynamoDbDerivedMap,
    I extends Record<string, GGDynamoDbIndexDef>,
    S extends string = never,
> {

    public readonly index: {[K in keyof I]: GGDynamoDbIndexQuery<Flat<T>, D, GGDynamoDbIndexRow<Flat<T>, D, PK, SK, I[K], GGDynamoDbRow<T, D>>, I[K]["pk"], I[K] extends {sk: infer X} ? X : never, I[K] extends {local: true} ? true : false>}
    public readonly tx: GGDynamoDbTransactBuilder<T, D, PK, SK, S>
    public readonly spec: GGDynamoDbTableSpec<T, PK, SK, D, I, S>
    private readonly db: GGDynamoDb
    private readonly base: GGDynamoDbIndexQuery<Flat<T>, D, GGDynamoDbRow<T, D>, PK, SK, true>

    constructor(db: GGDynamoDb, spec: GGDynamoDbTableSpec<T, PK, SK, D, I, S>) {
        this.db = db
        this.spec = spec
        this.index = Object.fromEntries(Object.entries(spec.indexes).map(([k, i]) => [k, new GGDynamoDbIndexQuery(db, this, i as GGDynamoDbResolvedIndex)])) as any
        this.base = new GGDynamoDbIndexQuery(db, this, spec.tableIndex)
        this.tx = new GGDynamoDbTransactBuilder(this)
    }

    /**
     * A base class bound to `spec`, for a store that adds its own methods and inherits the rest:
     *
     *     class ProjectStore extends GGDynamoDbTypedTable.of(ProjectsTable) {
     *         listByOrg(orgId: string) { return this.index.byOrg.query({orgId}) }
     *     }
     *     new ProjectStore(db)
     */
    static of<Spec extends GGDynamoDbTableSpec<any, any, any, any, any, any>>(spec: Spec): new (db: GGDynamoDb, opts?: GGDynamoDbTableOptions) => GGDynamoDbTableOf<Spec> {
        return class extends GGDynamoDbTypedTable<any, any, any, any, any, any> {
            constructor(db: GGDynamoDb, opts?: GGDynamoDbTableOptions) {
                super(db, opts?.name ? spec.withName(opts.name) : spec)
            }
        } as any
    }

    get tableName(): string {
        return this.spec.name
    }

    /** Strongly consistent by default, as `GGDynamoDb.get`. */
    async get(key: Key<Flat<T>, D, PK, SK>, opts?: GGDynamoDbConsistentReadOption): Promise<GGDynamoDbRow<T, D> | undefined> {
        const k = this.spec.keyObject(key)
        const row = this.fromStored<GGDynamoDbRow<T, D>>(await this.db.get<Source>(this.tableName, this.spec.storedKey(k), opts))
        return row && this.holdsKey(row, k) ? row : undefined
    }

    /** The rows for `keys`, in their order, missing ones skipped and repeated keys read once. Eventually consistent by
     *  default. */
    async getMany(keyArgs: Key<Flat<T>, D, PK, SK>[], opts?: GGDynamoDbConsistentReadOption): Promise<GGDynamoDbRow<T, D>[]> {
        const keys = keyArgs.map(k => this.spec.keyObject(k))
        const wanted = uniqueBy(keys.map(k => this.spec.storedKey(k)), k => this.keyId(k))
        const found = new Map<string, GGDynamoDbRow<T, D>>()
        await this.batch("getMany", wanted, BATCH_GET_MAX_KEYS, async pending => {
            const res: BatchGetCommandOutput = await this.db.getDocumentClient().send(new BatchGetCommand({
                RequestItems: {[this.tableName]: {Keys: pending, ...(opts?.consistentRead && {ConsistentRead: true})}},
            }))
            for (const item of res.Responses?.[this.tableName] ?? []) found.set(this.keyId(item), this.fromStored<GGDynamoDbRow<T, D>>(item)!)
            return res.UnprocessedKeys?.[this.tableName]?.Keys
        })
        return keys.flatMap(k => {
            const row = found.get(this.keyId(this.spec.storedKey(k)))
            return row && this.holdsKey(row, k) ? [row] : []
        }).filter((row, i, rows) => rows.indexOf(row) === i)
    }

    query(...args: QueryArgs<GGDynamoDbKeyInput<Flat<T>, D, PK>, GGDynamoDbTypedQueryOptions<Flat<T>, D, SK extends string ? SK : never, PK> & GGDynamoDbConsistentReadOption>): Promise<GGDynamoDbRow<T, D>[]> {
        return this.base.query(...args as [any, any])
    }

    queryPage(...args: QueryArgs<GGDynamoDbKeyInput<Flat<T>, D, PK>, GGDynamoDbTypedQueryPageOptions<Flat<T>, D, SK extends string ? SK : never> & GGDynamoDbConsistentReadOption>): Promise<GGDynamoDbPage<GGDynamoDbRow<T, D>>> {
        return this.base.queryPage(...args as [any, any])
    }

    /** Validates, derives, writes the whole row. False when `opts.if` fails. Not on a versioned table, whose writes
     *  are `save`, `create` and `update`. */
    async put(row: T, opts?: GGDynamoDbWriteOptions<Flat<T>>): Promise<boolean> {
        this.unversioned("put")
        return this.sendPut(this.putParams(row, opts))
    }

    /** `put` only when no row has the key yet (on a versioned table, as version 1). False when one has. */
    async create(row: T): Promise<boolean> {
        return this.sendPut(this.createParams(row))
    }

    /**
     * Optimistic locking on the spec's `version`: writes `row` while the stored version is still `row.version`, storing
     * the version plus one. A row without a version counts as 0, which a missing row or one stored before the table had
     * a version also is: so `save` of a row without one may create the row or replace an unversioned one (use `create`
     * for a write that must be new). Returns the row as written, or undefined when another write got there first: re-read
     * and retry.
     */
    async save(row: T): Promise<GGDynamoDbRow<T, D> | undefined> {
        const p = this.saveParams(row)
        return await this.sendPut(p) ? this.spec.toRow(p.Item) : undefined
    }

    /** Deletes the row and returns it as it was, atomically: for a one-time token or claim. Undefined when there was no
     *  row or `opts.if` failed. */
    async take(key: Key<Flat<T>, D, PK, SK>, opts?: GGDynamoDbWriteOptions<Flat<T>>): Promise<GGDynamoDbRow<T, D> | undefined> {
        try {
            const res = await this.db.getDocumentClient().send(new DeleteCommand({...this.keyParams(key, opts?.if), ReturnValues: "ALL_OLD"}))
            return this.fromStored<GGDynamoDbRow<T, D>>(res.Attributes)
        } catch (err) {
            if (isConditionFailed(err)) return undefined
            throw err
        }
    }

    /** `put` for many rows, 25 per request, unconditionally (DynamoDB's batch write takes no conditions) and not
     *  atomically: on an error some rows may be written. Of rows with the same key the last is written. */
    async putMany(rows: T[]): Promise<void> {
        this.unversioned("putMany")
        const items = uniqueBy(rows.map(r => this.putParams(r, undefined).Item).reverse(), item => this.keyId(item)).reverse()
        await this.batchWrite("putMany", items.map(Item => ({PutRequest: {Item}})))
    }

    /** `delete` for many keys, 25 per request, unconditionally and not atomically. */
    async deleteMany(keys: Key<Flat<T>, D, PK, SK>[]): Promise<void> {
        const unique = uniqueBy(keys.map(k => this.spec.storedKey(this.spec.keyObject(k))), k => this.keyId(k))
        await this.batchWrite("deleteMany", unique.map(Key => ({DeleteRequest: {Key}})))
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
    async update(key: Key<Flat<T>, D, PK, SK>, fields: Writable<Flat<T>, D, PK, SK>, opts?: GGDynamoDbUpdateOptions<Flat<T>, KeyFields<Flat<T>, D, PK, SK>, S>): Promise<GGDynamoDbRow<T, D> | undefined> {
        try {
            const res = await this.db.getDocumentClient().send(new UpdateCommand({...this.updateParams(key, fields, opts), ReturnValues: "ALL_NEW"}))
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
    async delete(key: Key<Flat<T>, D, PK, SK>, opts?: GGDynamoDbWriteOptions<Flat<T>>): Promise<boolean> {
        const p = this.keyParams(key, opts?.if)
        if (!p.ConditionExpression) {
            await this.db.delete(this.tableName, p.Key)
            return true
        }
        return this.db.deleteConditional(this.tableName, p.Key, p.ConditionExpression, p.ExpressionAttributeValues, p.ExpressionAttributeNames)
    }

    /** Every row (capped like `GGDynamoDb.scan`). `filter` trims what comes back, not what is read. */
    async scan(opts?: {filter?: GGDynamoDbCondition<Flat<T>>, limit?: number, consistentRead?: boolean}): Promise<GGDynamoDbRow<T, D>[]> {
        const e = this.expr()
        const filter = opts?.filter && e.condition(opts.filter)
        const rows = await this.db.scan<Source>(this.tableName, {limit: opts?.limit, consistentRead: opts?.consistentRead, filter, names: e.names, values: e.values})
        return rows.map(r => this.fromStored<GGDynamoDbRow<T, D>>(r)!)
    }

    /** One page of a scan; `segment` / `totalSegments` split it across parallel workers. */
    async scanPage(opts?: {limit?: number, cursor?: string, consistentRead?: boolean, segment?: number, totalSegments?: number}): Promise<GGDynamoDbPage<GGDynamoDbRow<T, D>>> {
        const page = await this.db.scanPage<Source>(this.tableName, opts)
        return {items: page.items.map(r => this.fromStored<GGDynamoDbRow<T, D>>(r)!), cursor: page.cursor}
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
            if (!this.spec.schema.safeParse(this.spec.toRow(item)).success) return "skipped"
            const key = pick(item, this.spec.keyAttributes)
            let computed: {name: string, deps: readonly string[], value: unknown}[]
            try {
                computed = this.spec.indexDerived.map(({name, key}) => ({name, deps: key.deps, value: key.compute(item)}))
            } catch (err) {
                failed.push({key, error: err instanceof Error ? err.message : String(err)})
                return "failed"
            }
            const stale = computed.filter(d => d.value !== item[d.name])
            if (stale.length === 0) return "same"
            const e = this.expr()
            const set = stale.filter(d => d.value !== undefined)
            const remove = stale.filter(d => d.value === undefined)
            const deps = [...new Set(stale.flatMap(d => d.deps))]
            try {
                await this.db.getDocumentClient().send(new UpdateCommand({
                    TableName: this.tableName,
                    Key: key,
                    UpdateExpression: e.updateExpression({
                        set: set.map(d => `${e.name(d.name)} = ${e.value(d.value)}`),
                        remove: remove.map(d => e.name(d.name)),
                        add: this.spec.version ? [`${e.name(this.spec.version)} ${e.value(1)}`] : [],
                    }),
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
            skipped: results.filter(r => r === "skipped").length,
            failed,
            cursor: page.cursor,
        }
    }

    /** @internal */
    putParams(row: T, opts: GGDynamoDbWriteOptions<Flat<T>> | undefined) {
        return {TableName: this.tableName, Item: this.spec.withDerived(this.validate(row)) as Source, ...(opts?.if && this.expr().conditionInput(opts.if))}
    }

    /** @internal */
    createParams(row: T) {
        const v = this.spec.version
        return this.putParams(v ? {...row, [v]: 1} : row, {if: this.absent()})
    }

    /** @internal */
    saveParams(row: T) {
        const field = this.versionField("save")
        const expected = ((row as Source)[field] as number | undefined) ?? 0
        return this.putParams({...row, [field]: expected + 1}, {if: this.versionIs(field, expected)})
    }

    /** @internal A whole-row write can't count from the stored version, so a versioned table takes none. */
    unversioned(op: string): void {
        if (this.spec.version) throw new Error(`${this.tableName}.${op}: the table is versioned; write with save, create or update`)
    }

    private async sendPut(p: ReturnType<GGDynamoDbTypedTable<T, PK, SK, D, I, S>["putParams"]>): Promise<boolean> {
        if (!p.ConditionExpression) {
            await this.db.put(this.tableName, p.Item)
            return true
        }
        return this.db.putConditional(this.tableName, p.Item, p.ConditionExpression, p.ExpressionAttributeValues, p.ExpressionAttributeNames)
    }

    /** @internal A request on one row, with an optional condition; on the key's own inputs too when its value doesn't
     *  name exactly one set of them. */
    keyParams(keyArg: Key<Flat<T>, D, PK, SK>, condition: GGDynamoDbCondition<Flat<T>> | undefined) {
        const key = this.spec.keyObject(keyArg)
        const pins = Object.entries(this.spec.unpinnedKeyInputs(key)).map(([f, v]) => ({[f]: v === undefined ? {exists: false} : {eq: v}}))
        const all = [...pins, ...(condition ? [condition] : [])] as GGDynamoDbCondition<Flat<T>>[]
        return {TableName: this.tableName, Key: this.spec.storedKey(key), ...this.expr().conditionInput(all.length > 0 ? {allOf: all} as GGDynamoDbCondition<Flat<T>> : undefined)}
    }

    /** @internal No row has this row's key yet. */
    absent(): GGDynamoDbCondition<Flat<T>> {
        return {[this.spec.pk]: {exists: false}} as GGDynamoDbCondition<Flat<T>>
    }

    private versionField(op: string): string {
        if (!this.spec.version) throw new Error(`${this.tableName}.${op}: the spec has no version field`)
        return this.spec.version
    }

    // Rows written before the table had a version carry none, which counts as 0.
    private versionIs(field: string, expected: number): GGDynamoDbCondition<Flat<T>> {
        return (expected === 0 ? {anyOf: [{[field]: {exists: false}}, {[field]: {eq: 0}}]} : {[field]: {eq: expected}}) as GGDynamoDbCondition<Flat<T>>
    }

    private holdsKey(row: object, key: Source): boolean {
        return Object.entries(this.spec.unpinnedKeyInputs(key)).every(([f, v]) => deepEqual((row as Source)[f], v))
    }

    /** @internal */
    expr(): GGDynamoDbExpr {
        return new GGDynamoDbExpr((field, value) => this.spec.encodeField(field, value))
    }

    /** @internal */
    updateParams(keyArg: Key<Flat<T>, D, PK, SK>, given: object, opts: GGDynamoDbUpdateOptions<Flat<T>, any, any> | undefined) {
        const fail = (msg: string): never => { throw new Error(`${this.tableName}.update: ${msg}`) }
        const {spec} = this
        const fields: Source = opts?.skipUndefined ? Object.fromEntries(definedEntries(given)) : {...given}
        const key = spec.keyObject(keyArg)
        const keys = Object.keys(fields)
        for (const k of keys) {
            if (spec.keyFields.includes(k)) fail(`"${k}" is part of the table key`)
            if (spec.derivedKey(k)) fail(`"${k}" is derived; write its inputs instead`)
            if (k === spec.version) fail(`"${k}" is the version; every write bumps it (give expectVersion to check it)`)
        }
        if (opts?.upsert && opts.current) fail("an upsert can't take current: a row it creates holds none of it")
        if (opts?.expectVersion !== undefined && opts.upsert) fail("an upsert can't take expectVersion")
        const checkedVersion = opts?.expectVersion !== undefined ? this.versionField("update") : undefined
        const valid = this.validFields(fields, fail)
        const e = this.expr()
        const storedKey = spec.storedKey(key)
        const keyInputs = pick(key as Source, spec.keyFields)

        const keyChecks = Object.entries(spec.unpinnedKeyInputs(keyInputs)).map(([dep, v]) => e.unchanged(dep, v))
        const conditions: string[] = opts?.upsert
            ? keyChecks.length > 0 ? [`(attribute_not_exists(${e.name(spec.pk)}) OR (${keyChecks.join(" AND ")}))`] : []
            : [`attribute_exists(${e.name(spec.pk)})`, ...keyChecks]
        if (opts?.if) conditions.push(e.condition(opts.if))
        if (checkedVersion) conditions.push(e.condition(this.versionIs(checkedVersion, opts!.expectVersion!)))
        const known: Source = {...conditionPins(opts?.if), ...keyInputs}

        const set: string[] = []
        const remove: string[] = []
        for (const k of keys) {
            const value = spec.encodeField(k, valid[k])
            if (value === undefined) remove.push(e.name(k))
            else set.push(`${e.name(k)} = ${e.value(value)}`)
        }
        if (opts?.upsert) {
            for (const [k, v] of Object.entries(keyInputs)) if (!spec.keyAttributes.includes(k)) set.push(`${e.name(k)} = ${e.value(v)}`)
        }

        const touched = new Set(keys)
        const claim = (field: string, op: string) => {
            if (spec.keyFields.includes(field)) fail(`${op} "${field}": it is part of the table key`)
            if (field === spec.version) fail(`${op} "${field}": it is the version, which every write bumps`)
            if (touched.has(field)) fail(`"${field}" is written twice (${op})`)
            touched.add(field)
        }
        const add = this.atomicOps(opts?.add, "add", fail)
        const del = this.atomicOps(opts?.delete, "delete", fail)
        for (const o of add) claim(o.field, "add")
        for (const o of del) claim(o.field, "delete")
        for (const [field, value] of definedEntries(opts?.setIfMissing)) {
            claim(field, "setIfMissing")
            const stored = spec.encodeField(field, this.validFields({[field]: value}, fail)[field])
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
            // `merge` sets keys in a map that must exist, and `delete` removes: neither can make a missing row's field.
            const created = [...add.map(o => o.field), ...definedEntries(opts.setIfMissing).map(([f]) => f), ...definedEntries(opts.append).map(([f]) => f), ...(spec.version ? [spec.version] : [])]
            const covered = new Set([...keys.filter(k => fields[k] !== undefined), ...Object.keys(keyInputs), ...created])
            const missing = spec.requiredFields.filter(f => !covered.has(f))
            if (missing.length > 0) fail(`an upsert may create the row, which then needs ${missing.join(", ")}: give them in fields, setIfMissing or add`)
        }

        const conditionedOnCurrent = new Set<string>()
        for (const {name, key: derived} of spec.indexDerived) {
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
        // Every write bumps the version: `ADD` counts from 0 on a row without one.
        if (spec.version) add.push({field: spec.version, value: 1})
        return {
            TableName: this.tableName,
            Key: storedKey,
            UpdateExpression: e.updateExpression({
                set,
                remove,
                add: add.map(o => `${e.name(o.field)} ${e.value(o.value)}`),
                delete: del.map(o => `${e.name(o.field)} ${e.value(o.value)}`),
            }),
            ...(conditions.length > 0 && {ConditionExpression: conditions.join(" AND ")}),
            ExpressionAttributeNames: e.names,
            ...e.valuesInput(),
        }
    }

    /** @internal */
    fromStored<R>(item: Source | undefined): R | undefined {
        return item && this.spec.toRow(item) as unknown as R
    }

    private keyId(item: Source): string {
        return JSON.stringify(this.spec.keyAttributes.map(a => item[a]))
    }

    private async batchWrite(op: string, requests: object[]): Promise<void> {
        await this.batch(op, requests, BATCH_WRITE_MAX_ITEMS, async pending => {
            const res: BatchWriteCommandOutput = await this.db.getDocumentClient().send(new BatchWriteCommand({RequestItems: {[this.tableName]: pending}}))
            return res.UnprocessedItems?.[this.tableName]
        })
    }

    // In chunks of `size`, a few at once; DynamoDB hands back what it throttled as unprocessed, to be resent after a
    // backoff. Once a chunk fails the others stop resending, so nothing is written after the caller has the error.
    private async batch<R>(op: string, requests: R[], size: number, send: (pending: R[]) => Promise<R[] | undefined>): Promise<void> {
        const chunks = Array.from({length: Math.ceil(requests.length / size)}, (_, i) => requests.slice(i * size, (i + 1) * size))
        let failed = false
        await mapLimit(chunks, BATCH_CONCURRENCY, async chunk => {
            let pending: R[] | undefined = chunk
            for (let attempt = 0; pending && pending.length > 0 && !failed; attempt++) {
                if (attempt === BATCH_MAX_ATTEMPTS) throw new Error(`${this.tableName}.${op}: ${pending.length} item(s) still unprocessed after ${attempt} attempts`)
                if (attempt > 0) await new Promise(r => setTimeout(r, Math.random() * BATCH_FIRST_RETRY_MS * 2 ** (attempt - 1)))
                if (failed) return
                try {
                    pending = await send(pending)
                } catch (err) {
                    failed = true
                    throw err
                }
            }
        })
    }

    private validate(row: T): T {
        const result = this.spec.schema.safeParse(row)
        if (!result.success) {
            throw new Error(`${this.tableName}.put: schema validation failed for ${JSON.stringify(pick(row as Source, this.spec.keyFields))}: ${JSON.stringify(result.issues)}`)
        }
        return result.value
    }

    // Field by field against the spec's own field schemas, which compile once.
    private validFields(fields: Source, fail: (msg: string) => never): Source {
        const valid: Source = {}
        for (const [k, v] of Object.entries(fields)) {
            const schema = this.spec.fieldSchema(k)
            if (!schema) return fail(`"${k}" is not a schema field`)
            const parsed = schema.safeParse(v)
            if (!parsed.success) return fail(`schema validation failed for "${k}": ${JSON.stringify(parsed.issues)}`)
            if (parsed.value !== undefined) valid[k] = parsed.value
        }
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

    private atomicOps(ops: object | undefined, op: "add" | "delete", fail: (msg: string) => never): {field: string, value: unknown}[] {
        return definedEntries(ops).map(([field, value]) => {
            if (this.spec.sets.has(field)) {
                const stored = this.spec.encodeField(field, this.validFields({[field]: value}, fail)[field])
                if (stored === undefined) fail(`${op} "${field}" needs a non-empty array of its elements`)
                return {field, value: stored}
            }
            if (op === "delete") fail(`delete "${field}" needs a field declared in the spec's sets`)
            if (this.spec.fieldType(field) === "array") fail(`add "${field}" needs the field declared in the spec's sets`)
            if (this.spec.fieldType(field) !== "number" || !Number.isFinite(value)) fail(`add "${field}" needs a number field and a number`)
            return {field, value}
        })
    }
}

export class GGDynamoDbIndexQuery<T extends object, D, Row, PKA, SKA, Local = false> {

    private readonly db: GGDynamoDb
    private readonly table: GGDynamoDbTypedTable<any, any, any, any, any, any>
    private readonly def: GGDynamoDbResolvedIndex

    constructor(db: GGDynamoDb, table: GGDynamoDbTypedTable<any, any, any, any, any, any>, def: GGDynamoDbResolvedIndex) {
        this.db = db
        this.table = table
        this.def = def
    }

    /** Every match, following DynamoDB's paging (capped like `GGDynamoDb.query`; `limit` bounds it). */
    async query(...[key, opts]: QueryArgs<GGDynamoDbKeyInput<T, D, PKA>, GGDynamoDbTypedQueryOptions<T, D, SKA, PKA> & ConsistentRead<Local>>): Promise<Row[]> {
        const e = this.table.expr()
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
        const e = this.table.expr()
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

    put(row: T, opts?: GGDynamoDbWriteOptions<Flat<T>>): GGDynamoDbTransactItem {
        this.table.unversioned("tx.put")
        return {Put: this.table.putParams(row, opts)}
    }

    /** `put` only when no row has the key yet. */
    create(row: T): GGDynamoDbTransactItem {
        return {Put: this.table.createParams(row)}
    }

    /** `save`'s versioned write. */
    save(row: T): GGDynamoDbTransactItem {
        return {Put: this.table.saveParams(row)}
    }

    update(key: Key<Flat<T>, D, PK, SK>, fields: Writable<Flat<T>, D, PK, SK>, opts?: GGDynamoDbUpdateOptions<Flat<T>, KeyFields<Flat<T>, D, PK, SK>, S>): GGDynamoDbTransactItem {
        return {Update: this.table.updateParams(key, fields, opts)}
    }

    delete(key: Key<Flat<T>, D, PK, SK>, opts?: GGDynamoDbWriteOptions<Flat<T>>): GGDynamoDbTransactItem {
        return {Delete: this.table.keyParams(key, opts?.if)}
    }

    check(key: Key<Flat<T>, D, PK, SK>, condition: GGDynamoDbCondition<Flat<T>>): GGDynamoDbTransactItem {
        const params = this.table.keyParams(key, condition)
        return {ConditionCheck: {...params, ConditionExpression: params.ConditionExpression!}}
    }
}

// Stops starting items once one has failed; items already running finish.
async function mapLimit<A, R>(items: A[], limit: number, fn: (item: A) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let next = 0
    let failed = false
    await Promise.all(Array.from({length: Math.min(Math.max(limit, 1), items.length)}, async () => {
        while (next < items.length && !failed) {
            const i = next++
            try {
                results[i] = await fn(items[i])
            } catch (err) {
                failed = true
                throw err
            }
        }
    }))
    return results
}

function uniqueBy<A>(items: A[], id: (item: A) => string): A[] {
    const seen = new Set<string>()
    return items.filter(item => {
        const key = id(item)
        return !seen.has(key) && !!seen.add(key)
    })
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

// As DynamoDB compares: a map's keys in any order, a list's elements in order.
function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false
    const ka = Object.keys(a)
    return ka.length === Object.keys(b).length && ka.every(k => Object.hasOwn(b, k) && deepEqual((a as Source)[k], (b as Source)[k]))
}

function isConditionFailed(err: unknown): boolean {
    return (err as {name?: string}).name === "ConditionalCheckFailedException"
}
