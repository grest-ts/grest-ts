import type {CreateTableCommandInput, ScalarAttributeType, UpdateTimeToLiveCommandInput} from "@aws-sdk/client-dynamodb"
import type {GGSchema} from "@grest-ts/schema"

type Fields<T> = keyof T & string
type Prettify<T> = {[K in keyof T]: T[K]} & {}
type Source = Record<string, unknown>
type Required<T, K extends keyof T> = {[P in K]-?: NonNullable<T[P]>}

/**
 * An attribute the library computes from the row on every write, for use as an index key or the table's own key.
 * `undefined` (or `""`, which DynamoDB can't index) means the row carries no such attribute, which keeps it out of every
 * index keyed on it. `V` is the stored value; `Q` what a query passes to address it: the fields it is computed from.
 */
export class GGDynamoDbDerivedKey<V, Q> {
    declare readonly _types?: {value: V, query: Q}

    public readonly kind: "join" | "flag" | "value"
    public readonly deps: readonly string[]
    /** `undefined` when the type is that of the one schema field it stores. */
    public readonly attributeType: ScalarAttributeType | undefined
    /** Absent on some rows by design (`flag`, `.when`); never a table key. */
    public readonly sparse: boolean
    /** Returned on reads (`.readable()`), not only stored. */
    public readonly isReadable: boolean = false
    private readonly fn: (row: Source) => V | undefined
    // What a flag is queried by: it has no inputs to compute it from.
    private readonly constant: V | undefined

    constructor(kind: "join" | "flag" | "value", deps: readonly string[], fn: (row: Source) => V | undefined, attributeType: ScalarAttributeType | undefined, sparse = false, constant?: V) {
        this.kind = kind
        this.deps = deps
        this.fn = fn
        this.attributeType = attributeType
        this.sparse = sparse
        this.constant = constant
    }

    compute(row: Source): V | undefined {
        const value = this.fn(Object.fromEntries(this.deps.map(d => [d, row[d]])))
        return value === "" ? undefined : value
    }

    /** The value a query or key addresses, computed from `input`; throws when it computes none. */
    fromQuery(input: Source, name: string): V {
        if (this.constant !== undefined) return this.constant
        const value = this.compute(input)
        if (value === undefined) throw new Error(`GGDynamoDb: "${name}" needs ${this.deps.join(", ")}, got ${JSON.stringify(input)}`)
        return value
    }

    /** Also return this attribute on reads, as the stored value, so readers don't recompute it. */
    readable(): this & GGDynamoDbReadable {
        return Object.assign(Object.create(Object.getPrototypeOf(this)), this, {isReadable: true})
    }
}

/** Marks a derived attribute returned on reads. */
export interface GGDynamoDbReadable {
    readonly __readable: true
}

export class GGDynamoDbJoinKey<T, P extends Fields<T>, V> extends GGDynamoDbDerivedKey<V, Required<T, P>> {

    public readonly parts: readonly P[]
    public readonly sep: string
    private readonly test: ((row: Source) => boolean) | undefined

    constructor(parts: readonly P[], test?: (row: Source) => boolean, extraDeps: readonly string[] = [], sep = "#") {
        super("join", [...new Set([...parts, ...extraDeps])], row => test && !test(row) ? undefined : joinParts(parts, row, sep), parts.length === 1 ? undefined : "S", !!test)
        this.parts = parts
        this.sep = sep
        this.test = test
    }

    /** The row is in the index only while `test` holds; `test` sees just `deps`. Not for a table key. */
    when<const W extends Fields<T>>(deps: readonly W[], test: (row: Pick<T, W>) => boolean): GGDynamoDbJoinKey<T, P, V> {
        const outer = this.test
        return new GGDynamoDbJoinKey<T, P, V>(this.parts, row => (!outer || outer(row)) && test(row as Pick<T, W>), [...this.deps, ...deps], this.sep)
    }

    /** Join with `sep` instead of `#`. */
    separator(sep: string): GGDynamoDbJoinKey<T, P, V> {
        if (!sep) throw new Error("GGDynamoDb: a join separator can't be empty")
        return new GGDynamoDbJoinKey<T, P, V>(this.parts, this.test, this.deps, sep)
    }

    /** Leading `parts` as a sort-key condition: all of them match the value, fewer match `"<a><sep>..."`. */
    prefixCondition(input: Source): {eq: string} | {beginsWith: string} {
        const given = this.parts.filter(p => input[p] !== undefined)
        if (this.parts.length < 2 || given.length === 0 || given.some((p, i) => p !== this.parts[i])) {
            throw new Error(`GGDynamoDb: a prefix of join(${this.parts.join(", ")}) takes its leading parts, got ${given.join(", ") || "none"}`)
        }
        const value = joinString(given, input, this.sep)
        if (given.length === this.parts.length) return {eq: value}
        // A leading part is never the key's last, so the separator in it would match rows of another prefix.
        const last = given[given.length - 1]
        if (String(input[last]).includes(this.sep)) throw new Error(`GGDynamoDb: join part "${last}" contains "${this.sep}": ${JSON.stringify(input[last])}`)
        return {beginsWith: value + this.sep}
    }
}

const NUMBER_TYPES = ["number", "int", "uint", "posInt", "int8", "int16", "int32", "uint8", "uint16", "uint32"]

// One part is stored as itself, keeping its type; several as a string.
function joinParts(parts: readonly string[], row: Source, sep: string): any {
    if (parts.some(p => row[p] === undefined || row[p] === null)) return undefined
    return parts.length === 1 ? row[parts[0]] : joinString(parts, row, sep)
}

function joinString(parts: readonly string[], row: Source, sep: string): string {
    return parts.map((p, i) => {
        const v = String(row[p])
        // The separator inside a part but the last would let two rows share one key.
        if (i < parts.length - 1 && v.includes(sep)) throw new Error(`GGDynamoDb: join part "${p}" contains "${sep}": ${JSON.stringify(v)}`)
        return v
    }).join(sep)
}

type IsUnion<U, A = U> = U extends unknown ? ([A] extends [U] ? false : true) : never

export class GGDynamoDbDerivedBuilder<T> {

    /** One field: its value. Several: `"a#b"` (`.separator(":")` for another), sorting as strings (pad numbers with
     *  `string()` when order matters); the separator in a part but the last is refused. Absent while any part is
     *  undefined. Queried by its parts. */
    join<const P extends Fields<T>>(...parts: P[]): GGDynamoDbJoinKey<T, P, true extends IsUnion<P> ? string : NonNullable<T[P]>> {
        if (parts.length === 0) throw new Error("GGDynamoDb: join() needs at least one field")
        return new GGDynamoDbJoinKey<T, P, any>(parts)
    }

    /** `"1"` (or `opts.value`) while `test` holds, absent otherwise: the sparse-marker pattern. Queried with no key input. */
    flag<const W extends Fields<T>, const V extends string = "1">(deps: readonly W[], test: (row: Pick<T, W>) => boolean, opts?: {value: V}): GGDynamoDbDerivedKey<V, {}> {
        const value = (opts?.value ?? "1") as V
        return new GGDynamoDbDerivedKey<V, {}>("flag", deps, row => test(row as Pick<T, W>) ? value : undefined, "S", true, value)
    }

    /** `fn`'s result; queried by `deps`, from which it is computed. */
    string<const W extends Fields<T>, V extends string>(deps: readonly W[], fn: (row: Pick<T, W>) => V | undefined): GGDynamoDbDerivedKey<V, Required<T, W>> {
        return new GGDynamoDbDerivedKey<V, Required<T, W>>("value", deps, row => fn(row as Pick<T, W>), "S")
    }

    /** As `string`, stored as a number. */
    number<const W extends Fields<T>, V extends number>(deps: readonly W[], fn: (row: Pick<T, W>) => V | undefined): GGDynamoDbDerivedKey<V, Required<T, W>> {
        return new GGDynamoDbDerivedKey<V, Required<T, W>>("value", deps, row => fn(row as Pick<T, W>), "N")
    }
}

type KeysOfUnion<T> = T extends unknown ? keyof T : never
type ValueIn<T, K extends PropertyKey> = T extends unknown ? K extends keyof T ? T[K] : undefined : never
type FlatUnion<T, C extends PropertyKey = keyof T> = Prettify<{[K in C]: ValueIn<T, K>} & {[K in Exclude<KeysOfUnion<T>, C>]?: ValueIn<T, K>}>

/** A union of row shapes seen field by field: a field some shapes lack is optional. A plain object row is itself. */
export type GGDynamoDbFlat<T> = true extends IsUnion<T> ? FlatUnion<T> : T

/** Derived attributes returned on reads, with their stored value types; absent where not computed (a flag that
 *  doesn't hold, a part that is undefined). */
export type GGDynamoDbReadableOf<D> = {[K in keyof D as D[K] extends GGDynamoDbReadable ? K : never]?: D[K] extends GGDynamoDbDerivedKey<infer V, any> ? V : never}

/** A row as reads return it: the schema's shape plus the `.readable()` derived attributes. */
export type GGDynamoDbRow<T, D> = [keyof GGDynamoDbReadableOf<D>] extends [never] ? T : T & GGDynamoDbReadableOf<D>

export type GGDynamoDbDerivedMap = Record<string, GGDynamoDbDerivedKey<any, any>>

export type GGDynamoDbProjection<F extends string> = "ALL" | "KEYS_ONLY" | readonly F[]

export interface GGDynamoDbIndexDef<A extends string = string, F extends string = string> {
    /** Defaults to `<pk>-<sk>-index`, or `<pk>-index` without a sort key. */
    name?: string
    pk: A
    sk?: A
    /** A list is DynamoDB's INCLUDE. Default `"ALL"`. With KEYS_ONLY / INCLUDE the table key's inputs are projected too,
     *  so a row can be addressed. */
    projection?: GGDynamoDbProjection<F>
    /** A local secondary index: same `pk` as the table, its own `sk`. Supports `consistentRead`; created with the table
     *  only, and caps each partition (table rows plus index entries) at 10 GB. */
    local?: true
}

export interface GGDynamoDbTableSpecInput<T extends object, PK, SK, D, I, S, TTL = string, F = GGDynamoDbFlat<T>> {
    name: string
    /** The row: an `IsObject`, or a union of them (`IsDiscriminated` / `IsUnion`) for a table holding several row
     *  shapes. Field-level options (keys, derived inputs, conditions, updates) see the union field by field. */
    schema: GGSchema<T>
    pk: PK
    sk?: SK
    derived?: (d: GGDynamoDbDerivedBuilder<F>) => D
    indexes?: I
    /** Array fields stored as DynamoDB sets (unique elements, atomic `add` / `delete` in `update`); read back as arrays.
     *  An empty one is stored as no attribute: DynamoDB has no empty set. */
    sets?: readonly S[]
    /** A number attribute (a field, or a `d.number` derived one) holding the Unix time, in seconds, after which DynamoDB
     *  may delete the row (TTL; usually within a few days, and reads see it until then). Enabled by `timeToLiveInput()`
     *  or `GGDynamoDbDevTables.ensure`, not by `createTableInput()`. */
    ttl?: TTL
    /** A number field counting the row's writes: every write stores it plus one, and `save` / `update`'s `expectVersion`
     *  write only while it still holds what was read (optimistic locking). */
    version?: GGDynamoDbNumberFields<F>
}

export type GGDynamoDbArrayFields<T> = {[K in keyof T & string]-?: NonNullable<T[K]> extends readonly (string | number)[] ? K : never}[keyof T & string]

export type GGDynamoDbNumberFields<T> = {[K in keyof T & string]-?: NonNullable<T[K]> extends number ? K : never}[keyof T & string]

/** Fields holding a map (an object, not an array or set). */
export type GGDynamoDbMapFields<T> = {[K in keyof T & string]-?: NonNullable<T[K]> extends readonly unknown[] ? never : NonNullable<T[K]> extends object ? K : never}[keyof T & string]

/** What a query passes for the key attribute `A`: a derived key's inputs, or the attribute's value. */
export type GGDynamoDbKeyInput<T, D, A> =
    A extends keyof D
        ? D[A] extends GGDynamoDbDerivedKey<any, infer Q> ? Q : never
        : A extends keyof T ? {[K in A]: NonNullable<T[A]>} : never

export type GGDynamoDbAttrValue<T, D, A> =
    A extends keyof D
        ? D[A] extends GGDynamoDbDerivedKey<infer V, any> ? V : never
        : A extends keyof T ? NonNullable<T[A]> : never

/** Sort-key conditions. Operands are stored values, or for a derived key its inputs; a `join` of several parts also
 *  takes `prefix`, its leading parts. */
export type GGDynamoDbSkCondition<T, D, A> =
    | GGDynamoDbValueRange<GGDynamoDbAttrValue<T, D, A> | (A extends keyof D ? GGDynamoDbKeyInput<T, D, A> : never), GGDynamoDbAttrValue<T, D, A>>
    | (A extends keyof D ? D[A] extends GGDynamoDbJoinKey<any, infer P, any> ? true extends IsUnion<P> ? {prefix: Partial<GGDynamoDbKeyInput<T, D, A>>} : never : never : never)

export type GGDynamoDbValueRange<O, V = O> =
    | {eq: O} | {lt: O} | {lte: O} | {gt: O} | {gte: O} | {between: [O, O]}
    | ([V] extends [string] ? {beginsWith: string} : never)


/** A row's address: the table key's fields, or a derived key's inputs. */
export type GGDynamoDbTableKey<T, D, PK, SK> = Prettify<GGDynamoDbKeyInput<T, D, PK> & (SK extends string ? GGDynamoDbKeyInput<T, D, SK> : {})>

/** Fields fixed once a row exists: they make up its key. */
export type GGDynamoDbKeyFields<T, D, PK, SK> = keyof GGDynamoDbTableKey<T, D, PK, SK> & keyof T

type IndexKeyFields<I> = (I extends {pk: infer P} ? P : never) | (I extends {sk: infer S} ? S : never)

/** A row as `I`'s projection returns it: KEYS_ONLY and INCLUDE carry the table key's fields, the index's key fields
 *  and what they list. */
export type GGDynamoDbIndexRow<T, D, PK, SK, I, Row = T> =
    I extends {projection: readonly (infer F)[]}
        ? Prettify<Pick<T, (GGDynamoDbKeyFields<T, D, PK, SK> | IndexKeyFields<I> | F) & keyof T>>
        : I extends {projection: "KEYS_ONLY"} ? Prettify<Pick<T, (GGDynamoDbKeyFields<T, D, PK, SK> | IndexKeyFields<I>) & keyof T>> : Row

// On the result, not the input: any use of `D` in the input fixes it before the `derived` callback is inferred.
type CheckSpec<T, D, PK, SK, I, TTL, Ok> =
    [keyof D & keyof T] extends [never]
        ? [PK | Exclude<SK, undefined>] extends [Fields<T> | keyof D]
            ? [BadIndexes<T, D, I>] extends [never]
                ? [Exclude<TTL, undefined>] extends [GGDynamoDbNumberFields<T> | NumberDerived<D>] ? Ok : `ttl "${Exclude<TTL, undefined> & string}" is not a number field or a d.number attribute`
                : `index "${BadIndexes<T, D, I>}" is keyed on an attribute that is neither a field nor derived`
            : `the table key "${Exclude<PK | SK, Fields<T> | keyof D | undefined> & string}" is neither a field nor derived`
        : `derived "${keyof D & keyof T & string}" is also a schema field`

type NumberDerived<D> = {[K in keyof D & string]: D[K] extends GGDynamoDbDerivedKey<infer V, any> ? [V] extends [number] ? K : never : never}[keyof D & string]

type BadIndexes<T, D, I> = {
    [K in keyof I & string]: I[K] extends {pk: infer P} ? P extends Fields<T> | keyof D
        ? I[K] extends {sk: infer S} ? S extends Fields<T> | keyof D ? never : K : never
        : K : never
}[keyof I & string]

export interface GGDynamoDbResolvedIndex {
    key: string
    /** `undefined` for the table itself. */
    indexName: string | undefined
    pk: string
    sk: string | undefined
    local?: true
}

type IndexWithProjection = GGDynamoDbResolvedIndex & {projection: GGDynamoDbProjection<string>}

/**
 * One table's declaration: row schema, keys, derived attributes and indexes. Has no runtime dependencies, so a seed
 * script or test can build `createTableInput()` without a connection. Bind it with `new GGDynamoDbTypedTable(db, spec)`.
 */
export class GGDynamoDbTableSpec<
    T extends object,
    PK extends string,
    SK extends string | undefined,
    D extends GGDynamoDbDerivedMap,
    I extends Record<string, GGDynamoDbIndexDef>,
    S extends string = never,
> {

    public readonly name: string
    public readonly schema: GGSchema<T>
    public readonly pk: PK
    public readonly sk: SK
    public readonly derived: ReadonlyArray<{name: string, key: GGDynamoDbDerivedKey<unknown, unknown>}>
    /** `derived` less the table's own key attributes: what a write may rewrite. */
    public readonly indexDerived: ReadonlyArray<{name: string, key: GGDynamoDbDerivedKey<unknown, unknown>}>
    public readonly sets: ReadonlySet<string>
    public readonly ttl: string | undefined
    public readonly version: string | undefined
    /** The stored key attributes: `pk`, and `sk` when there is one. */
    public readonly keyAttributes: readonly string[]
    /** The fields that make up the table key: plain key fields, or a derived key's inputs. Fixed once a row exists. */
    public readonly keyFields: readonly string[]
    public readonly indexes: Readonly<Record<keyof I & string, IndexWithProjection>>
    public readonly requiredFields: readonly string[]
    declare readonly _sets?: S
    private readonly fieldSchemas: Record<string, GGSchema<unknown>>
    private readonly derivedByName: ReadonlyMap<string, GGDynamoDbDerivedKey<unknown, unknown>>

    private constructor(input: GGDynamoDbTableSpecInput<T, PK, SK, D, I, S>) {
        this.name = input.name
        this.schema = input.schema
        this.pk = input.pk
        this.sk = input.sk as SK
        this.fieldSchemas = fieldSchemasOf(input.schema as GGSchema<unknown>, this.name)
        const derived = input.derived?.(new GGDynamoDbDerivedBuilder<GGDynamoDbFlat<T>>()) ?? {}
        this.derived = Object.entries(derived as GGDynamoDbDerivedMap).map(([name, key]) => ({name, key}))
        this.derivedByName = new Map(this.derived.map(d => [d.name, d.key]))
        this.sets = new Set(input.sets ?? [])
        this.ttl = input.ttl
        this.version = input.version
        this.keyAttributes = this.sk ? [this.pk, this.sk] : [this.pk]
        this.indexDerived = this.derived.filter(d => !this.keyAttributes.includes(d.name))
        this.requiredFields = Object.entries(this.fieldSchemas).filter(([, f]) => !f.def.optional).map(([f]) => f)
        this.keyFields = [...new Set(this.keyAttributes.flatMap(a => this.derivedKey(a)?.deps ?? [a]))]

        const fail = (msg: string): never => { throw new Error(`GGDynamoDbTableSpec '${this.name}': ${msg}`) }
        for (const {name, key} of this.derived) {
            if (name in this.fieldSchemas) fail(`derived "${name}" is also a schema field`)
            for (const dep of key.deps) {
                if (!(dep in this.fieldSchemas)) fail(`derived "${name}" reads unknown field "${dep}"`)
                if (this.sets.has(dep)) fail(`derived "${name}" reads the set "${dep}"`)
            }
        }
        for (const attr of this.keyAttributes) {
            const key = this.derivedKey(attr)
            if (!key) continue
            if (key.sparse) fail(`the table key "${attr}" can't be sparse (flag / when)`)
            if (key instanceof GGDynamoDbJoinKey) for (const p of key.parts) if (this.fieldSchemas[p].def.optional) fail(`the table key "${attr}" joins the optional field "${p}"`)
        }
        for (const f of this.sets) {
            if (this.fieldType(f) !== "array") fail(`set "${f}" is not an array field`)
            // An empty set is stored as no attribute, so a required one couldn't be read back.
            if (!this.fieldSchemas[f].def.optional) fail(`set "${f}" must be optional`)
        }
        if (this.ttl && !(this.fieldType(this.ttl) === "number" || (this.derivedKey(this.ttl) && this.attributeType(this.ttl) === "N"))) fail(`ttl "${this.ttl}" is not a number field or a d.number attribute`)
        if (this.version && this.fieldType(this.version) !== "number") fail(`version "${this.version}" is not a number field`)
        if (this.version && this.keyFields.includes(this.version)) fail(`version "${this.version}" is part of the table key`)
        for (const {name, key} of this.derived) if (this.version && key.deps.includes(this.version)) fail(`derived "${name}" reads the version "${this.version}"`)
        for (const f of this.keyFields) if (this.sets.has(f)) fail(`set "${f}" is part of the table key`)
        const indexes: Record<string, IndexWithProjection> = {}
        for (const [key, def] of Object.entries(input.indexes ?? {}) as [string, GGDynamoDbIndexDef][]) {
            const indexName = def.name ?? (def.sk ? `${def.pk}-${def.sk}-index` : `${def.pk}-index`)
            if (Object.values(indexes).some(i => i.indexName === indexName)) fail(`two indexes are named "${indexName}"`)
            for (const f of Array.isArray(def.projection) ? def.projection : []) if (!(f in this.fieldSchemas)) fail(`index "${key}" projects unknown field "${f}"`)
            if (def.local && (def.pk !== this.pk || !def.sk || !this.sk)) fail(`local index "${key}" needs a table with a sort key, the table's pk ("${this.pk}") and its own sk`)
            indexes[key] = {key, indexName, pk: def.pk, sk: def.sk, projection: this.projection(def), ...(def.local && {local: true as const})}
        }
        this.indexes = indexes as any
        for (const attr of this.allKeyAttributes()) this.attributeType(attr)
    }

    static define<
        T extends object,
        const PK extends string,
        const D extends GGDynamoDbDerivedMap = {},
        const I extends Record<string, GGDynamoDbIndexDef<string, Fields<GGDynamoDbFlat<T>>>> = {},
        const SK extends string | undefined = undefined,
        const S extends GGDynamoDbArrayFields<GGDynamoDbFlat<T>> = never,
        const TTL extends string | undefined = undefined,
    >(input: GGDynamoDbTableSpecInput<T, PK, SK, D, I, S, TTL>): CheckSpec<GGDynamoDbFlat<T>, D, PK, SK, I, TTL, GGDynamoDbTableSpec<T, PK, SK, D, I, S>> {
        return new GGDynamoDbTableSpec(input as GGDynamoDbTableSpecInput<T, PK, SK, D, I, S>) as any
    }

    get tableIndex(): GGDynamoDbResolvedIndex {
        return {key: "table", indexName: undefined, pk: this.pk, sk: this.sk}
    }

    /** The stored key for `input` (`GGDynamoDbTableKey`): derived key attributes computed from their inputs. */
    storedKey(input: Source): Source {
        return Object.fromEntries(this.keyAttributes.map(a => {
            const derived = this.derivedKey(a)
            const value = derived ? derived.fromQuery(input, a) : input[a]
            if (value === undefined || value === "") throw new Error(`${this.name}: the key needs ${derived ? derived.deps.join(", ") : a}`)
            return [a, value]
        }))
    }

    /** The inputs of a `string` / `number` table key, which may map several inputs to one value: a row read or
     *  written by `input` must hold them. Empty for plain and `join` keys, whose value names exactly one set of inputs. */
    unpinnedKeyInputs(input: Source): Source {
        return Object.fromEntries(this.keyAttributes
            .filter(a => this.derivedKey(a)?.kind === "value")
            .flatMap(a => this.derivedKey(a)!.deps)
            .map(dep => [dep, input[dep]]))
    }

    /** UpdateTimeToLive input enabling the spec's `ttl`, or undefined without one. */
    timeToLiveInput(): UpdateTimeToLiveCommandInput | undefined {
        return this.ttl ? {TableName: this.name, TimeToLiveSpecification: {AttributeName: this.ttl, Enabled: true}} : undefined
    }

    /** `row` with its derived attributes and fields stored as they are (`encodeField`), for a write that can't go
     *  through `GGDynamoDbTypedTable` (a seed script, a test fixture). Not validated; throws when the row has no key. */
    withDerived(row: T): T {
        const item: Source = {}
        for (const [field, value] of Object.entries(row)) {
            if (this.derivedByName.has(field)) continue
            const stored = this.encodeField(field, value)
            if (stored !== undefined) item[field] = stored
        }
        for (const {name, key} of this.derived) {
            const value = key.compute(row as Source)
            if (value !== undefined) item[name] = value
        }
        for (const a of this.keyAttributes) if (item[a] === undefined || item[a] === "") throw new Error(`${this.name}: the row has no key "${a}"`)
        return item as T
    }

    /** A stored item as a row: the schema's fields and `.readable()` derived attributes only, `sets` fields as arrays.
     *  Other derived attributes and attributes the schema no longer has stay on the stored item, out of the app's
     *  sight; an `update` leaves them there, a `put` of the row replaces the item and drops them. */
    toRow(item: Source): GGDynamoDbRow<T, D> {
        const row: Source = {}
        for (const [field, value] of Object.entries(item)) {
            if (!this.fieldSchema(field) && !this.derivedKey(field)?.isReadable) continue
            row[field] = value instanceof Set && this.sets.has(field) ? [...value] : value
        }
        return row as GGDynamoDbRow<T, D>
    }

    /** This spec on another table name, e.g. one per environment or test run. */
    withName(name: string): this {
        return Object.assign(Object.create(Object.getPrototypeOf(this)), this, {name})
    }

    /** `key` as an object: a table keyed on one plain field also takes that field's bare value. */
    keyObject(key: unknown): Source {
        if (typeof key === "object" && key !== null) return key as Source
        if (this.sk || this.derivedKey(this.pk)) throw new Error(`${this.name}: the key needs ${this.keyFields.join(", ")}`)
        return {[this.pk]: key}
    }

    /** `value` as `field` is stored: a `sets` field's array as a set, and an empty one as no attribute (DynamoDB has
     *  no empty set). */
    encodeField(field: string, value: unknown): unknown {
        if (!this.sets.has(field) || !Array.isArray(value)) return value
        return value.length > 0 ? new Set(value) : undefined
    }

    /** CreateTable input for local and test tables. No BillingMode: spread it in. */
    createTableInput(): CreateTableCommandInput {
        const keySchema = (pk: string, sk: string | undefined) => [
            {AttributeName: pk, KeyType: "HASH" as const},
            ...(sk ? [{AttributeName: sk, KeyType: "RANGE" as const}] : []),
        ]
        const toIndex = (i: IndexWithProjection) => ({
            IndexName: i.indexName,
            KeySchema: keySchema(i.pk, i.sk),
            Projection: Array.isArray(i.projection)
                ? {ProjectionType: "INCLUDE" as const, NonKeyAttributes: [...i.projection]}
                : {ProjectionType: i.projection as "ALL" | "KEYS_ONLY"},
        })
        const global = Object.values(this.indexes).filter(i => !i.local)
        const local = Object.values(this.indexes).filter(i => i.local)
        return {
            TableName: this.name,
            KeySchema: keySchema(this.pk, this.sk),
            AttributeDefinitions: this.allKeyAttributes().map(a => ({AttributeName: a, AttributeType: this.attributeType(a)})),
            ...(global.length > 0 && {GlobalSecondaryIndexes: global.map(toIndex)}),
            ...(local.length > 0 && {LocalSecondaryIndexes: local.map(toIndex)}),
        }
    }

    /** @internal */
    fieldSchema(field: string): GGSchema<unknown> | undefined {
        return Object.hasOwn(this.fieldSchemas, field) ? this.fieldSchemas[field] : undefined
    }

    /** @internal */
    derivedKey(attr: string): GGDynamoDbDerivedKey<unknown, unknown> | undefined {
        return this.derivedByName.get(attr)
    }

    /** @internal The field's schema type, with the number kinds as "number". */
    fieldType(field: string): string | undefined {
        const type = this.fieldSchema(field)?.toCompilerDef().type
        return type && NUMBER_TYPES.includes(type) ? "number" : type
    }

    // A KEYS_ONLY / INCLUDE index carries the table's and its own key attributes, which DynamoDB won't take as
    // NonKeyAttributes; when the table key is derived, a row read back is only addressable through its inputs.
    private projection(def: GGDynamoDbIndexDef): GGDynamoDbProjection<string> {
        const projection = def.projection ?? "ALL"
        if (projection === "ALL") return projection
        const carried = new Set<string | undefined>([...this.keyAttributes, def.pk, def.sk])
        const listed = [...new Set([...(projection === "KEYS_ONLY" ? [] : projection), ...this.keyFields])].filter(f => !carried.has(f))
        return listed.length === 0 ? "KEYS_ONLY" : listed
    }

    private allKeyAttributes(): string[] {
        return [...new Set([...this.keyAttributes, ...Object.values(this.indexes).flatMap(i => [i.pk, i.sk])].filter((a): a is string => !!a))]
    }

    private attributeType(attr: string): ScalarAttributeType {
        const derived = this.derivedKey(attr)
        if (derived) return derived.attributeType ?? this.attributeType(derived.deps[0])
        const type = this.fieldType(attr)
        if (!type) throw new Error(`GGDynamoDbTableSpec '${this.name}': key "${attr}" is neither a schema field nor derived`)
        const values = (this.fieldSchemas[attr].toCompilerDef() as {values?: readonly unknown[]}).values
        if (type === "string" || (type === "literal" && values?.every(v => typeof v === "string"))) return "S"
        if (type === "number" || (type === "literal" && values?.every(v => typeof v === "number"))) return "N"
        throw new Error(`GGDynamoDbTableSpec '${this.name}': key "${attr}" must be a string or number field, not ${type}`)
    }
}

type FieldSchema = GGSchema<unknown>

/**
 * Each field's schema, from an object row or a union of object rows. A field some variants lack is optional; one whose
 * variants differ accepts what any of them accepts.
 */
function fieldSchemasOf(schema: GGSchema<unknown>, table: string): Record<string, FieldSchema> {
    const shapes = variantShapes(schema, table)
    const names = [...new Set(shapes.flatMap(s => Object.keys(s)))]
    return Object.fromEntries(names.map(name => {
        const present = shapes.map(s => s[name]).filter((f): f is FieldSchema => !!f)
        const everywhere = present.length === shapes.length
        if (present.length === 1 && everywhere) return [name, present[0]]
        return [name, anyOf(present, !everywhere)]
    }))
}

function variantShapes(schema: GGSchema<unknown>, table: string): Record<string, FieldSchema>[] {
    const def = schema.toCompilerDef() as {type: string, shape?: Record<string, FieldSchema>, variants?: readonly GGSchema<unknown>[], discriminator?: string, variantMap?: ReadonlyMap<unknown, GGSchema<unknown>>}
    if (def.type === "object" && def.shape) return [def.shape]
    if (def.type === "union" && def.variants) return def.variants.flatMap(v => variantShapes(v, table))
    if (def.type === "discriminated" && def.variantMap && def.discriminator) {
        const field = def.discriminator
        return [...def.variantMap].map(([value, variant]) => {
            const shape = variantShapes(variant, table)[0]
            return shape[field] ? shape : {...shape, [field]: literal(value)}
        })
    }
    throw new Error(`GGDynamoDbTableSpec '${table}': the row schema must be an object or a union of objects, not ${def.type}`)
}

// The field a discriminated union keys on, where a variant doesn't declare it itself.
function literal(value: unknown): FieldSchema {
    return {
        def: {type: "literal", optional: false},
        toCompilerDef: () => ({type: "literal", values: [value]}),
        safeParse: (v: unknown) => v === value ? {success: true, value: v} : {success: false, issues: [{message: `must be ${JSON.stringify(value)}`}]},
    } as unknown as FieldSchema
}

function anyOf(schemas: FieldSchema[], optional: boolean): FieldSchema {
    const defs = schemas.map(s => s.toCompilerDef() as {type: string, values?: readonly unknown[]})
    const type = defs.every(d => d.type === defs[0].type) ? defs[0].type : "union"
    const compiled = {type, values: defs.flatMap(d => d.values ?? []), ...(schemas.length === 1 && schemas[0].toCompilerDef())}
    return {
        def: {type, optional: optional || schemas.some(s => s.def.optional)},
        toCompilerDef: () => compiled,
        safeParse: (v: unknown) => {
            if (v === undefined && optional) return {success: true, value: v}
            let last
            for (const s of schemas) {
                last = s.safeParse(v)
                if (last.success) return last
            }
            return last
        },
    } as unknown as FieldSchema
}
