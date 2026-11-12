import type {CreateTableCommandInput, ScalarAttributeType, UpdateTimeToLiveCommandInput} from "@aws-sdk/client-dynamodb"
import type {GGSchema, ObjectSchema} from "@grest-ts/schema"

type Fields<T> = keyof T & string
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
    private readonly fn: (row: Source) => V | undefined

    constructor(kind: "join" | "flag" | "value", deps: readonly string[], fn: (row: Source) => V | undefined, attributeType: ScalarAttributeType | undefined, sparse = false) {
        this.kind = kind
        this.deps = deps
        this.fn = fn
        this.attributeType = attributeType
        this.sparse = sparse
    }

    compute(row: Source): V | undefined {
        const value = this.fn(Object.fromEntries(this.deps.map(d => [d, row[d]])))
        return value === "" ? undefined : value
    }

    /** The value a query or key addresses, computed from `input`; throws when it computes none. */
    fromQuery(input: Source, name: string): V {
        if (this.kind === "flag") return "1" as V
        const value = this.compute(input)
        if (value === undefined) throw new Error(`GGDynamoDb: "${name}" needs ${this.deps.join(", ")}, got ${JSON.stringify(input)}`)
        return value
    }
}

export class GGDynamoDbJoinKey<T, P extends Fields<T>, V> extends GGDynamoDbDerivedKey<V, Required<T, P>> {

    public readonly parts: readonly P[]
    private readonly test: ((row: Source) => boolean) | undefined

    constructor(parts: readonly P[], test?: (row: Source) => boolean, extraDeps: readonly string[] = []) {
        super("join", [...new Set([...parts, ...extraDeps])], row => test && !test(row) ? undefined : joinParts(parts, row), parts.length === 1 ? undefined : "S", !!test)
        this.parts = parts
        this.test = test
    }

    /** The row is in the index only while `test` holds; `test` sees just `deps`. Not for a table key. */
    when<const W extends Fields<T>>(deps: readonly W[], test: (row: Pick<T, W>) => boolean): GGDynamoDbJoinKey<T, P, V> {
        const outer = this.test
        return new GGDynamoDbJoinKey<T, P, V>(this.parts, row => (!outer || outer(row)) && test(row as Pick<T, W>), [...this.deps, ...deps])
    }

    /** Leading `parts` as a sort-key condition: all of them match the value, fewer match `"<a>#..."`. */
    prefixCondition(input: Source): {eq: string} | {beginsWith: string} {
        const given = this.parts.filter(p => input[p] !== undefined)
        if (this.parts.length < 2 || given.length === 0 || given.some((p, i) => p !== this.parts[i])) {
            throw new Error(`GGDynamoDb: a prefix of join(${this.parts.join(", ")}) takes its leading parts, got ${given.join(", ") || "none"}`)
        }
        const value = joinString(given, input)
        return given.length === this.parts.length ? {eq: value} : {beginsWith: value + "#"}
    }
}

const NUMBER_TYPES = ["number", "int", "uint", "posInt", "int8", "int16", "int32", "uint8", "uint16", "uint32"]

// One part is stored as itself, keeping its type; several as a string.
function joinParts(parts: readonly string[], row: Source): any {
    if (parts.some(p => row[p] === undefined || row[p] === null)) return undefined
    return parts.length === 1 ? row[parts[0]] : joinString(parts, row)
}

function joinString(parts: readonly string[], row: Source): string {
    return parts.map(p => {
        const v = String(row[p])
        // The separator inside a part would let two rows share one key.
        if (v.includes("#")) throw new Error(`GGDynamoDb: join part "${p}" contains "#": ${JSON.stringify(v)}`)
        return v
    }).join("#")
}

type IsUnion<U, A = U> = U extends unknown ? ([A] extends [U] ? false : true) : never

export class GGDynamoDbDerivedBuilder<T> {

    /** One field: its value. Several: `"a#b"`, sorting as strings (pad numbers with `string()` when order matters); a
     *  part containing `#` is refused. Absent while any part is undefined. Queried by its parts. */
    join<const P extends Fields<T>>(...parts: P[]): GGDynamoDbJoinKey<T, P, true extends IsUnion<P> ? string : NonNullable<T[P]>> {
        if (parts.length === 0) throw new Error("GGDynamoDb: join() needs at least one field")
        return new GGDynamoDbJoinKey<T, P, any>(parts)
    }

    /** `"1"` while `test` holds, absent otherwise: the sparse-marker pattern. Queried with no key input. */
    flag<const W extends Fields<T>>(deps: readonly W[], test: (row: Pick<T, W>) => boolean): GGDynamoDbDerivedKey<"1", {}> {
        return new GGDynamoDbDerivedKey<"1", {}>("flag", deps, row => test(row as Pick<T, W>) ? "1" : undefined, "S", true)
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

export interface GGDynamoDbTableSpecInput<T extends object, PK, SK, D, I, S> {
    name: string
    schema: ObjectSchema<T>
    pk: PK
    sk?: SK
    derived?: (d: GGDynamoDbDerivedBuilder<T>) => D
    indexes?: I
    /** Array fields stored as DynamoDB sets (unique elements, atomic `add` / `delete` in `update`); read back as arrays.
     *  An empty one is stored as no attribute: DynamoDB has no empty set. */
    sets?: readonly S[]
    /** A number field holding the Unix time, in seconds, after which DynamoDB may delete the row (TTL; usually within
     *  a few days, and reads see it until then). Enabled by `timeToLiveInput()`, not by `createTableInput()`. */
    ttl?: GGDynamoDbNumberFields<T>
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

type Prettify<T> = {[K in keyof T]: T[K]} & {}

/** A row's address: the table key's fields, or a derived key's inputs. */
export type GGDynamoDbTableKey<T, D, PK, SK> = Prettify<GGDynamoDbKeyInput<T, D, PK> & (SK extends string ? GGDynamoDbKeyInput<T, D, SK> : {})>

/** Fields fixed once a row exists: they make up its key. */
export type GGDynamoDbKeyFields<T, D, PK, SK> = keyof GGDynamoDbTableKey<T, D, PK, SK> & keyof T

type IndexKeyFields<I> = (I extends {pk: infer P} ? P : never) | (I extends {sk: infer S} ? S : never)

/** A row as `I`'s projection returns it: KEYS_ONLY and INCLUDE carry the table key's fields, the index's key fields
 *  and what they list. */
export type GGDynamoDbIndexRow<T, D, PK, SK, I> =
    I extends {projection: readonly (infer F)[]}
        ? Prettify<Pick<T, (GGDynamoDbKeyFields<T, D, PK, SK> | IndexKeyFields<I> | F) & keyof T>>
        : I extends {projection: "KEYS_ONLY"} ? Prettify<Pick<T, (GGDynamoDbKeyFields<T, D, PK, SK> | IndexKeyFields<I>) & keyof T>> : T

// On the result, not the input: any use of `D` in the input fixes it before the `derived` callback is inferred.
type CheckSpec<T, D, PK, SK, I, Ok> =
    [keyof D & keyof T] extends [never]
        ? [PK | Exclude<SK, undefined>] extends [Fields<T> | keyof D]
            ? [BadIndexes<T, D, I>] extends [never] ? Ok : `index "${BadIndexes<T, D, I>}" is keyed on an attribute that is neither a field nor derived`
            : `the table key "${Exclude<PK | SK, Fields<T> | keyof D | undefined> & string}" is neither a field nor derived`
        : `derived "${keyof D & keyof T & string}" is also a schema field`

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
    public readonly schema: ObjectSchema<T>
    public readonly pk: PK
    public readonly sk: SK
    public readonly derived: ReadonlyArray<{name: string, key: GGDynamoDbDerivedKey<unknown, unknown>}>
    /** `derived` less the table's own key attributes: what a write may rewrite. */
    public readonly indexDerived: ReadonlyArray<{name: string, key: GGDynamoDbDerivedKey<unknown, unknown>}>
    public readonly sets: ReadonlySet<string>
    public readonly ttl: string | undefined
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
        this.fieldSchemas = input.schema.toCompilerDef().shape as Record<string, GGSchema<unknown>>
        const derived = input.derived?.(new GGDynamoDbDerivedBuilder<T>()) ?? {}
        this.derived = Object.entries(derived as GGDynamoDbDerivedMap).map(([name, key]) => ({name, key}))
        this.derivedByName = new Map(this.derived.map(d => [d.name, d.key]))
        this.sets = new Set(input.sets ?? [])
        this.ttl = input.ttl
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
        if (this.ttl && this.fieldType(this.ttl) !== "number") fail(`ttl "${this.ttl}" is not a number field`)
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
        const I extends Record<string, GGDynamoDbIndexDef<string, Fields<T>>> = {},
        const SK extends string | undefined = undefined,
        const S extends GGDynamoDbArrayFields<T> = never,
    >(input: GGDynamoDbTableSpecInput<T, PK, SK, D, I, S>): CheckSpec<T, D, PK, SK, I, GGDynamoDbTableSpec<T, PK, SK, D, I, S>> {
        return new GGDynamoDbTableSpec(input) as any
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

    /** A stored item without its derived attributes and with set fields as arrays, for an item read outside `GGDynamoDbTypedTable`. */
    withoutDerived(item: Source): T {
        const row: Source = {}
        for (const [field, value] of Object.entries(item)) {
            if (this.derivedByName.has(field)) continue
            row[field] = value instanceof Set && this.sets.has(field) ? [...value] : value
        }
        return row as T
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
