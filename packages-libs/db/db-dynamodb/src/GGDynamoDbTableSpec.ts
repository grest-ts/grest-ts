import type {CreateTableCommandInput, ScalarAttributeType} from "@aws-sdk/client-dynamodb"
import type {GGSchema, ObjectSchema} from "@grest-ts/schema"

declare const BY_VALUE: unique symbol
type ByValue = typeof BY_VALUE

type Fields<T> = keyof T & string
type Source = Record<string, unknown>

/**
 * An attribute the library computes from the row on every write, for use as an index key. `undefined` means the row
 * carries no such attribute, which keeps it out of every index keyed on it.
 * `V` is the stored value; `Q` what a query passes to address it.
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

    private readonly parts: readonly P[]
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
}

function joinParts(parts: readonly string[], row: Source): any {
    const values = parts.map(p => row[p])
    if (values.some(v => v === undefined || v === null)) return undefined
    return values.length === 1 ? values[0] : values.map(String).join("#")
}

export class GGDynamoDbDerivedBuilder<T> {

    /** One field: its value. Several: `"a#b"`. Absent while any part is undefined. Queried by its parts. */
    join<const P extends Fields<T>>(...parts: P[]): GGDynamoDbJoinKey<T, P, [P] extends [infer One extends keyof T] ? (string extends P ? string : NonNullable<T[One]>) : string> {
        if (parts.length === 0) throw new Error("GGDynamoDb: join() needs at least one field")
        return new GGDynamoDbJoinKey<T, P, any>(parts)
    }

    /** `"1"` while `test` holds, absent otherwise: the sparse-marker pattern. Queried with no key input. */
    flag<const W extends Fields<T>>(deps: readonly W[], test: (row: Pick<T, W>) => boolean): GGDynamoDbDerivedKey<"1", {}> {
        return new GGDynamoDbDerivedKey<"1", {}>(deps, row => test(row as Pick<T, W>) ? "1" : undefined, () => "1", "S")
    }

    string<const W extends Fields<T>, V extends string>(deps: readonly W[], fn: (row: Pick<T, W>) => V | undefined): GGDynamoDbDerivedKey<V, ByValue> {
        return new GGDynamoDbDerivedKey<V, ByValue>(deps, row => fn(row as Pick<T, W>), byValue as any, "S")
    }

    number<const W extends Fields<T>, V extends number>(deps: readonly W[], fn: (row: Pick<T, W>) => V | undefined): GGDynamoDbDerivedKey<V, ByValue> {
        return new GGDynamoDbDerivedKey<V, ByValue>(deps, row => fn(row as Pick<T, W>), byValue as any, "N")
    }
}

function byValue(input: Source, name: string): unknown {
    const value = input[name]
    if (value === undefined) throw new Error(`GGDynamoDb: query on "${name}" needs ${name}`)
    return value
}

export type GGDynamoDbDerivedMap = Record<string, GGDynamoDbDerivedKey<any, any>>

export type GGDynamoDbProjection<F extends string> = "ALL" | "KEYS_ONLY" | readonly F[]

export interface GGDynamoDbIndexDef<A extends string = string, F extends string = string> {
    /** Defaults to `<pk>-<sk>-index`, or `<pk>-index` without a sort key. */
    name?: string
    pk: A
    sk?: A
    /** A list is DynamoDB's INCLUDE. Default `"ALL"`. */
    projection?: GGDynamoDbProjection<F>
}

export interface GGDynamoDbTableSpecInput<T extends object, PK, SK, D, I> {
    name: string
    schema: ObjectSchema<T>
    pk: PK
    sk?: SK
    derived?: (d: GGDynamoDbDerivedBuilder<T>) => D
    indexes?: I
}

/** What a query passes for the key attribute `A`: a derived key's parts, or the attribute's value. */
export type GGDynamoDbKeyInput<T, D, A> =
    A extends keyof D
        ? D[A] extends GGDynamoDbDerivedKey<infer V, infer Q> ? ([Q] extends [ByValue] ? {[K in A & string]: V} : Q) : never
        : A extends keyof T ? {[K in A]: NonNullable<T[A]>} : never

export type GGDynamoDbAttrValue<T, D, A> =
    A extends keyof D
        ? D[A] extends GGDynamoDbDerivedKey<infer V, any> ? V : never
        : A extends keyof T ? NonNullable<T[A]> : never

export type GGDynamoDbTableKey<T, PK extends keyof T, SK> = {[K in PK | (SK extends keyof T ? SK : never)]: NonNullable<T[K]>}

type Prettify<T> = {[K in keyof T]: T[K]} & {}

type IndexKeyFields<I> = (I extends {pk: infer P} ? P : never) | (I extends {sk: infer S} ? S : never)

/** A row as `I`'s projection returns it: KEYS_ONLY and INCLUDE carry the table and index keys plus what they list. */
export type GGDynamoDbIndexRow<T, PK, SK, I> =
    I extends {projection: readonly (infer F)[]}
        ? Prettify<Pick<T, (PK | SK | IndexKeyFields<I> | F) & keyof T>>
        : I extends {projection: "KEYS_ONLY"} ? Prettify<Pick<T, (PK | SK | IndexKeyFields<I>) & keyof T>> : T

// On the result, not the input: any use of `D` in the input fixes it before the `derived` callback is inferred.
type CheckSpec<T, D, I, Ok> =
    [keyof D & keyof T] extends [never]
        ? [BadIndexes<T, D, I>] extends [never] ? Ok : `index "${BadIndexes<T, D, I>}" is keyed on an attribute that is neither a field nor derived`
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
}

/**
 * One table's declaration: row schema, keys, derived index attributes and indexes. Has no runtime dependencies, so a
 * seed script or test can build `createTableInput()` without a connection. Bind it with `new GGDynamoDbTypedTable(db, spec)`.
 */
export class GGDynamoDbTableSpec<
    T extends object,
    PK extends Fields<T>,
    SK extends Fields<T> | undefined,
    D extends GGDynamoDbDerivedMap,
    I extends Record<string, GGDynamoDbIndexDef>,
> {

    public readonly name: string
    public readonly schema: ObjectSchema<T>
    public readonly pk: PK
    public readonly sk: SK
    public readonly derived: ReadonlyArray<{name: string, key: GGDynamoDbDerivedKey<unknown, unknown>}>
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

        const fail = (msg: string) => { throw new Error(`GGDynamoDbTableSpec '${this.name}': ${msg}`) }
        for (const {name, key} of this.derived) {
            if (name in this.fieldSchemas) fail(`derived "${name}" is also a schema field`)
            for (const dep of key.deps) if (!(dep in this.fieldSchemas)) fail(`derived "${name}" reads unknown field "${dep}"`)
        }
        const indexes: Record<string, GGDynamoDbResolvedIndex & {projection: GGDynamoDbProjection<string>}> = {}
        for (const [key, def] of Object.entries(input.indexes ?? {}) as [string, GGDynamoDbIndexDef][]) {
            const indexName = def.name ?? (def.sk ? `${def.pk}-${def.sk}-index` : `${def.pk}-index`)
            if (Object.values(indexes).some(i => i.indexName === indexName)) fail(`two indexes are named "${indexName}"`)
            for (const f of Array.isArray(def.projection) ? def.projection : []) if (!(f in this.fieldSchemas)) fail(`index "${key}" projects unknown field "${f}"`)
            indexes[key] = {key, indexName, pk: def.pk, sk: def.sk, projection: def.projection ?? "ALL"}
        }
        this.indexes = indexes as any
        for (const attr of this.keyAttributes()) this.attributeType(attr)
    }

    static define<
        T extends object,
        const PK extends Fields<T>,
        const D extends GGDynamoDbDerivedMap = {},
        const I extends Record<string, GGDynamoDbIndexDef<string, Fields<T>>> = {},
        const SK extends Fields<T> | undefined = undefined,
    >(input: GGDynamoDbTableSpecInput<T, PK, SK, D, I>): CheckSpec<T, D, I, GGDynamoDbTableSpec<T, PK, SK, D, I>> {
        return new GGDynamoDbTableSpec(input) as any
    }

    get tableIndex(): GGDynamoDbResolvedIndex {
        return {key: "table", indexName: undefined, pk: this.pk, sk: this.sk}
    }

    /** `row` with its derived attributes, for a write that can't go through `GGDynamoDbTypedTable` (a seed script,
     *  a test fixture). Not validated. */
    withDerived(row: T): T {
        const item = {...row} as Record<string, unknown>
        for (const {name, key} of this.derived) {
            const value = key.compute(Object.fromEntries(key.deps.map(dep => [dep, item[dep]])))
            if (value === undefined) delete item[name]
            else item[name] = value
        }
        return item as T
    }

    /** A stored item without its derived attributes, for an item read outside `GGDynamoDbTypedTable`. */
    withoutDerived(item: Record<string, unknown>): T {
        const row = {...item}
        for (const {name} of this.derived) delete row[name]
        return row as T
    }

    /** CreateTable input for local and test tables. No BillingMode: spread it in. */
    createTableInput(): CreateTableCommandInput {
        const keySchema = (pk: string, sk: string | undefined) => [
            {AttributeName: pk, KeyType: "HASH" as const},
            ...(sk ? [{AttributeName: sk, KeyType: "RANGE" as const}] : []),
        ]
        const indexes = Object.values(this.indexes)
        return {
            TableName: this.name,
            KeySchema: keySchema(this.pk, this.sk),
            AttributeDefinitions: this.keyAttributes().map(a => ({AttributeName: a, AttributeType: this.attributeType(a)})),
            ...(indexes.length > 0 && {
                GlobalSecondaryIndexes: indexes.map(i => ({
                    IndexName: i.indexName,
                    KeySchema: keySchema(i.pk, i.sk),
                    Projection: Array.isArray(i.projection)
                        ? {ProjectionType: "INCLUDE" as const, NonKeyAttributes: [...i.projection]}
                        : {ProjectionType: i.projection as "ALL" | "KEYS_ONLY"},
                })),
            }),
        }
    }

    private keyAttributes(): string[] {
        return [...new Set([this.pk, this.sk, ...Object.values(this.indexes).flatMap(i => [i.pk, i.sk])].filter((a): a is string => !!a))]
    }

    private attributeType(attr: string): ScalarAttributeType {
        const derived = this.derived.find(d => d.name === attr)?.key
        if (derived) return derived.attributeType ?? this.attributeType(derived.deps[0])
        const schema = this.fieldSchemas[attr]
        if (!schema) throw new Error(`GGDynamoDbTableSpec '${this.name}': key "${attr}" is neither a schema field nor derived`)
        const def = schema.toCompilerDef() as {type: string, values?: readonly unknown[]}
        if (def.type === "string") return "S"
        if (["number", "int", "uint", "posInt", "int8", "int16", "int32", "uint8", "uint16", "uint32"].includes(def.type)) return "N"
        if (def.type === "literal" && def.values?.every(v => typeof v === "string")) return "S"
        if (def.type === "literal" && def.values?.every(v => typeof v === "number")) return "N"
        throw new Error(`GGDynamoDbTableSpec '${this.name}': key "${attr}" must be a string or number field, not ${def.type}`)
    }
}
