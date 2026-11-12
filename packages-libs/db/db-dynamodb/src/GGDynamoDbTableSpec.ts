import type {CreateTableCommandInput, ScalarAttributeType, UpdateTimeToLiveCommandInput} from "@aws-sdk/client-dynamodb"
import type {GGSchema, ObjectSchema} from "@grest-ts/schema"

type Fields<T> = keyof T & string
type Source = Record<string, unknown>

/**
 * An attribute the library computes from the row on every write, for use as an index key. `undefined` means the row
 * carries no such attribute, which keeps it out of every index keyed on it. A table's own `pk` / `sk` may be one too.
 * `V` is the stored value; `Q` what a query passes to address it: the fields it is computed from.
 */
export class GGDynamoDbDerivedKey<V, Q> {
    declare readonly _types?: {value: V, query: Q}

    public readonly deps: readonly string[]
    public readonly compute: (row: Source) => V | undefined
    public readonly fromQuery: (input: Source, name: string) => V
    /** `undefined` when the type is that of the one schema field it stores. */
    public readonly attributeType: ScalarAttributeType | undefined

    constructor(
        deps: readonly string[],
        compute: (row: Source) => V | undefined,
        fromQuery: (input: Source, name: string) => V,
        attributeType: ScalarAttributeType | undefined,
    ) {
        this.deps = deps
        this.compute = compute
        this.fromQuery = fromQuery
        this.attributeType = attributeType
    }
}

export class GGDynamoDbJoinKey<T, P extends Fields<T>, V> extends GGDynamoDbDerivedKey<V, {[K in P]: NonNullable<T[K]>}> {

    public readonly parts: readonly P[]
    private readonly test: ((row: Source) => boolean) | undefined

    constructor(parts: readonly P[], test?: (row: Source) => boolean, extraDeps: readonly string[] = []) {
        super(
            [...new Set([...parts, ...extraDeps])],
            row => test && !test(row) ? undefined : joinParts(parts, row),
            (input, name) => {
                const value = joinParts(parts, input)
                if (value === undefined) throw new Error(`GGDynamoDb: query on "${name}" needs ${parts.join(", ")}`)
                return value
            },
            parts.length === 1 ? undefined : "S",
        )
        this.parts = parts
        this.test = test
    }

    /** The row is in the index only while `test` holds; `test` sees just `deps`. */
    when<const W extends Fields<T>>(deps: readonly W[], test: (row: Pick<T, W>) => boolean): GGDynamoDbJoinKey<T, P, V> {
        return new GGDynamoDbJoinKey<T, P, V>(this.parts, row => (!this.test || this.test(row)) && test(row as Pick<T, W>), [...this.deps, ...deps])
    }

    /** The stored-value prefix for leading `parts`: `{a}` of `join("a", "b")` is `"<a>#"`. */
    prefixOf(input: Source): string {
        const given = this.parts.filter(p => input[p] !== undefined)
        if (given.length === 0 || given.some((p, i) => p !== this.parts[i])) {
            throw new Error(`GGDynamoDb: a prefix of join(${this.parts.join(", ")}) takes its leading parts, got ${given.join(", ") || "none"}`)
        }
        return given.map(p => String(input[p])).join("#") + (given.length < this.parts.length ? "#" : "")
    }
}

const NUMBER_TYPES = ["number", "int", "uint", "posInt", "int8", "int16", "int32", "uint8", "uint16", "uint32"]

function joinParts(parts: readonly string[], row: Source): any {
    const values = parts.map(p => row[p])
    if (values.some(v => v === undefined || v === null)) return undefined
    return values.length === 1 ? values[0] : values.map(String).join("#")
}

export class GGDynamoDbDerivedBuilder<T> {

    /** One field: its value. Several: `"a#b"`, sorting as strings (pad numbers with `string()` when order matters).
     *  Absent while any part is undefined. Queried by its parts. */
    join<const P extends Fields<T>>(...parts: P[]): GGDynamoDbJoinKey<T, P, [P] extends [infer One extends keyof T] ? (string extends P ? string : NonNullable<T[One]>) : string> {
        if (parts.length === 0) throw new Error("GGDynamoDb: join() needs at least one field")
        return new GGDynamoDbJoinKey<T, P, any>(parts)
    }

    /** `"1"` while `test` holds, absent otherwise: the sparse-marker pattern. Queried with no key input. */
    flag<const W extends Fields<T>>(deps: readonly W[], test: (row: Pick<T, W>) => boolean): GGDynamoDbDerivedKey<"1", {}> {
        return new GGDynamoDbDerivedKey<"1", {}>(deps, row => test(row as Pick<T, W>) ? "1" : undefined, () => "1", "S")
    }

    /** `fn`'s result; queried by `deps`, from which it is computed. */
    string<const W extends Fields<T>, V extends string>(deps: readonly W[], fn: (row: Pick<T, W>) => V | undefined): GGDynamoDbDerivedKey<V, Pick<T, W>> {
        return new GGDynamoDbDerivedKey<V, Pick<T, W>>(deps, row => fn(row as Pick<T, W>), fromDeps(deps, fn as (row: Source) => V | undefined), "S")
    }

    /** As `string`, stored as a number. */
    number<const W extends Fields<T>, V extends number>(deps: readonly W[], fn: (row: Pick<T, W>) => V | undefined): GGDynamoDbDerivedKey<V, Pick<T, W>> {
        return new GGDynamoDbDerivedKey<V, Pick<T, W>>(deps, row => fn(row as Pick<T, W>), fromDeps(deps, fn as (row: Source) => V | undefined), "N")
    }
}

function fromDeps<V>(deps: readonly string[], fn: (row: Source) => V | undefined): (input: Source, name: string) => V {
    return (input, name) => {
        const value = fn(Object.fromEntries(deps.map(d => [d, input[d]])))
        if (value === undefined) throw new Error(`GGDynamoDb: "${name}" computes no value from ${JSON.stringify(input)}`)
        return value
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

export interface GGDynamoDbTableSpecInput<T extends object, PK, SK, D, I> {
    name: string
    schema: ObjectSchema<T>
    pk: PK
    sk?: SK
    derived?: (d: GGDynamoDbDerivedBuilder<T>) => D
    indexes?: I
    /** Array fields stored as DynamoDB sets (unique elements, atomic `add` / `delete` in `update`); read back as arrays.
     *  An empty one is stored as no attribute: DynamoDB has no empty set. */
    sets?: readonly GGDynamoDbArrayFields<T>[]
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

/** Sort-key conditions on the stored value; a `join` sort key also takes `prefix`, its leading parts. */
export type GGDynamoDbSkCondition<T, D, A> =
    | GGDynamoDbValueRange<GGDynamoDbAttrValue<T, D, A>>
    | (A extends keyof D ? D[A] extends GGDynamoDbJoinKey<any, any, any> ? {prefix: Partial<GGDynamoDbKeyInput<T, D, A>>} : never : never)

export type GGDynamoDbValueRange<V> =
    | {eq: V} | {lt: V} | {lte: V} | {gt: V} | {gte: V} | {between: [V, V]}
    | (V extends string ? {beginsWith: string} : never)

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

/**
 * One table's declaration: row schema, keys, derived index attributes and indexes. Has no runtime dependencies, so a
 * seed script or test can build `createTableInput()` without a connection. Bind it with `new GGDynamoDbTypedTable(db, spec)`.
 */
export class GGDynamoDbTableSpec<
    T extends object,
    PK extends string,
    SK extends string | undefined,
    D extends GGDynamoDbDerivedMap,
    I extends Record<string, GGDynamoDbIndexDef>,
> {

    public readonly name: string
    public readonly schema: ObjectSchema<T>
    public readonly pk: PK
    public readonly sk: SK
    public readonly derived: ReadonlyArray<{name: string, key: GGDynamoDbDerivedKey<unknown, unknown>}>
    public readonly sets: ReadonlySet<string>
    public readonly ttl: string | undefined
    /** The fields that make up the table key: plain key fields, or a derived key's inputs. Fixed once a row exists. */
    public readonly keyFields: readonly string[]
    public readonly indexes: Readonly<Record<keyof I & string, GGDynamoDbResolvedIndex & {projection: GGDynamoDbProjection<string>}>>
    private readonly fieldSchemas: Record<string, GGSchema<unknown>>

    private constructor(input: GGDynamoDbTableSpecInput<T, PK, SK, D, I>) {
        this.name = input.name
        this.schema = input.schema
        this.pk = input.pk
        this.sk = input.sk as SK
        this.fieldSchemas = input.schema.toCompilerDef().shape as Record<string, GGSchema<unknown>>
        const derived = input.derived?.(new GGDynamoDbDerivedBuilder<T>()) ?? {}
        this.derived = Object.entries(derived as GGDynamoDbDerivedMap).map(([name, key]) => ({name, key}))
        this.sets = new Set(input.sets ?? [])
        this.ttl = input.ttl
        this.keyFields = [...new Set(this.keyAttributeNames().flatMap(a => this.derivedKey(a)?.deps ?? [a]))]

        const fail = (msg: string) => { throw new Error(`GGDynamoDbTableSpec '${this.name}': ${msg}`) }
        for (const {name, key} of this.derived) {
            if (name in this.fieldSchemas) fail(`derived "${name}" is also a schema field`)
            for (const dep of key.deps) if (!(dep in this.fieldSchemas)) fail(`derived "${name}" reads unknown field "${dep}"`)
        }
        for (const f of this.sets) if (this.fieldType(f) !== "array") fail(`set "${f}" is not an array field`)
        if (this.ttl && this.fieldType(this.ttl) !== "number") fail(`ttl "${this.ttl}" is not a number field`)
        for (const f of this.keyFields) if (this.sets.has(f)) fail(`set "${f}" is part of the table key`)
        const indexes: Record<string, GGDynamoDbResolvedIndex & {projection: GGDynamoDbProjection<string>}> = {}
        for (const [key, def] of Object.entries(input.indexes ?? {}) as [string, GGDynamoDbIndexDef][]) {
            const indexName = def.name ?? (def.sk ? `${def.pk}-${def.sk}-index` : `${def.pk}-index`)
            if (Object.values(indexes).some(i => i.indexName === indexName)) fail(`two indexes are named "${indexName}"`)
            for (const f of Array.isArray(def.projection) ? def.projection : []) if (!(f in this.fieldSchemas)) fail(`index "${key}" projects unknown field "${f}"`)
            if (def.local && (def.pk !== this.pk || !def.sk)) fail(`local index "${key}" needs the table's pk ("${this.pk}") and its own sk`)
            indexes[key] = {key, indexName, pk: def.pk, sk: def.sk, projection: this.projectKeyFields(def.projection ?? "ALL"), ...(def.local && {local: true as const})}
        }
        this.indexes = indexes as any
        for (const attr of this.keyAttributes()) this.attributeType(attr)
    }

    static define<
        T extends object,
        const PK extends string,
        const D extends GGDynamoDbDerivedMap = {},
        const I extends Record<string, GGDynamoDbIndexDef<string, Fields<T>>> = {},
        const SK extends string | undefined = undefined,
    >(input: GGDynamoDbTableSpecInput<T, PK, SK, D, I>): CheckSpec<T, D, PK, SK, I, GGDynamoDbTableSpec<T, PK, SK, D, I>> {
        return new GGDynamoDbTableSpec(input) as any
    }

    get tableIndex(): GGDynamoDbResolvedIndex {
        return {key: "table", indexName: undefined, pk: this.pk, sk: this.sk}
    }

    /** The stored key for `input` (`GGDynamoDbTableKey`): derived key attributes computed from their inputs. */
    storedKey(input: Record<string, unknown>): Record<string, unknown> {
        return Object.fromEntries(this.keyAttributeNames().map(a => {
            const derived = this.derivedKey(a)
            const value = derived ? derived.fromQuery(input, a) : input[a]
            if (value === undefined) throw new Error(`${this.name}: the key needs ${a}`)
            return [a, value]
        }))
    }

    /** UpdateTimeToLive input enabling the spec's `ttl`, or undefined without one. */
    timeToLiveInput(): UpdateTimeToLiveCommandInput | undefined {
        return this.ttl ? {TableName: this.name, TimeToLiveSpecification: {AttributeName: this.ttl, Enabled: true}} : undefined
    }

    /** `row` with its derived attributes and set fields as sets, for a write that can't go through `GGDynamoDbTypedTable` (a seed script,
     *  a test fixture). Not validated. */
    withDerived(row: T): T {
        const item = {...row} as Record<string, unknown>
        for (const f of this.sets) {
            const value = item[f] as unknown[] | undefined
            if (value?.length) item[f] = new Set(value)
            else delete item[f]
        }
        for (const {name, key} of this.derived) {
            const value = key.compute(Object.fromEntries(key.deps.map(dep => [dep, item[dep]])))
            if (value === undefined) delete item[name]
            else item[name] = value
        }
        return item as T
    }

    /** A stored item without its derived attributes and with set fields as arrays, for an item read outside `GGDynamoDbTypedTable`. */
    withoutDerived(item: Record<string, unknown>): T {
        const row = {...item}
        for (const {name} of this.derived) delete row[name]
        for (const f of this.sets) if (row[f] instanceof Set) row[f] = [...row[f]]
        return row as T
    }

    /** CreateTable input for local and test tables. No BillingMode: spread it in. */
    createTableInput(): CreateTableCommandInput {
        const keySchema = (pk: string, sk: string | undefined) => [
            {AttributeName: pk, KeyType: "HASH" as const},
            ...(sk ? [{AttributeName: sk, KeyType: "RANGE" as const}] : []),
        ]
        const toIndex = (i: GGDynamoDbResolvedIndex & {projection: GGDynamoDbProjection<string>}) => ({
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
            AttributeDefinitions: this.keyAttributes().map(a => ({AttributeName: a, AttributeType: this.attributeType(a)})),
            ...(global.length > 0 && {GlobalSecondaryIndexes: global.map(toIndex)}),
            ...(local.length > 0 && {LocalSecondaryIndexes: local.map(toIndex)}),
        }
    }

    private keyAttributeNames(): string[] {
        return this.sk ? [this.pk, this.sk] : [this.pk]
    }

    /** @internal */
    fieldSchema(field: string): GGSchema<unknown> | undefined {
        return this.fieldSchemas[field]
    }

    /** @internal */
    derivedKey(attr: string): GGDynamoDbDerivedKey<unknown, unknown> | undefined {
        return this.derived.find(d => d.name === attr)?.key
    }

    // A KEYS_ONLY / INCLUDE index carries the table's key attributes; when those are derived, a row read back is only
    // addressable through their inputs.
    private projectKeyFields(projection: GGDynamoDbProjection<string>): GGDynamoDbProjection<string> {
        const inputs = this.keyFields.filter(f => f !== this.pk && f !== this.sk)
        if (projection === "ALL" || inputs.length === 0) return projection
        return [...new Set([...(projection === "KEYS_ONLY" ? [] : projection), ...inputs])]
    }

    private keyAttributes(): string[] {
        return [...new Set([this.pk, this.sk, ...Object.values(this.indexes).flatMap(i => [i.pk, i.sk])].filter((a): a is string => !!a))]
    }

    /** @internal */
    fieldType(field: string): string | undefined {
        const type = this.fieldSchemas[field]?.toCompilerDef().type
        return type && NUMBER_TYPES.includes(type) ? "number" : type
    }

    private attributeType(attr: string): ScalarAttributeType {
        const derived = this.derivedKey(attr)
        if (derived) return derived.attributeType ?? this.attributeType(derived.deps[0])
        const schema = this.fieldSchemas[attr]
        if (!schema) throw new Error(`GGDynamoDbTableSpec '${this.name}': key "${attr}" is neither a schema field nor derived`)
        const def = schema.toCompilerDef() as {type: string, values?: readonly unknown[]}
        if (def.type === "string") return "S"
        if (NUMBER_TYPES.includes(def.type)) return "N"
        if (def.type === "literal" && def.values?.every(v => typeof v === "string")) return "S"
        if (def.type === "literal" && def.values?.every(v => typeof v === "number")) return "N"
        throw new Error(`GGDynamoDbTableSpec '${this.name}': key "${attr}" must be a string or number field, not ${def.type}`)
    }
}
