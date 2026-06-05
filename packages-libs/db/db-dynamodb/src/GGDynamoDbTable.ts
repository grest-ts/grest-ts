import type {GGSchema} from "@grest-ts/schema"
import type {GGDynamoDb} from "./GGDynamoDb"

/**
 * Schema-bound table gateway. Owns one DynamoDB table; all reads/writes
 * go through it. Validates against the schema on `put` / `putConditional`
 * — shape mistakes throw at the write boundary instead of becoming silent
 * DDB corruption. Reads are NOT validated (deliberate; pre-launch).
 *
 * Generic over `T` (entity) and `PK` (partition-key field name). Sort
 * keys are supported via the optional `skField` constructor argument
 * and `sk` argument to `get` / `delete`. The base signatures are loose
 * (accept any string PK/SK value); subclasses with composite keys
 * should override `get` / `delete` to tighten types — see the example
 * in the docstring of `delete` below.
 *
 * Subclass to add entity-specific helpers (typed index queries,
 * presence-checks, common projections). Mutation logic — anything that
 * does read-modify-write — should NOT live on the subclass; keep it at
 * the call site or in a domain service.
 */
export class GGDynamoDbTable<
    T extends object,
    PK extends keyof T & string,
> {

    /** Sort-key field name. `undefined` for HASH-only tables. */
    public readonly skField: string | undefined

    // `db` is `protected` — escape hatch for subclasses that need a
    // raw DDB op we haven't wrapped (BatchGet, TransactWrite, ...).
    protected readonly db: GGDynamoDb
    public readonly tableName: string
    // `schema` and `validate` are `private` on purpose. Validation
    // is the contract of `put` / `putConditional`; subclasses must
    // not bypass it by writing raw values via `this.db`.
    private readonly schema: GGSchema<T>
    public readonly pkField: PK

    constructor(
        db: GGDynamoDb,
        tableName: string,
        schema: GGSchema<T>,
        pkField: PK,
        skField?: keyof T & string,
    ) {
        this.db = db
        this.tableName = tableName
        this.schema = schema
        this.pkField = pkField
        this.skField = skField
    }

    async get(pk: T[PK], sk?: unknown): Promise<T | undefined> {
        return this.db.get<T>(this.tableName, this.buildKey(pk, sk))
    }

    /** Validates against the schema before writing. Throws on shape errors. */
    async put(item: T): Promise<void> {
        const validated = this.validate(item, "put")
        await this.db.put(this.tableName, validated)
    }

    /**
     * Validated conditional put. Returns true on success, false when the
     * condition fails. `attributeNames` is needed when the condition
     * references reserved DDB keywords (`version`, `name`, `status`...).
     */
    async putConditional(
        item: T,
        conditionExpression: string,
        values?: Record<string, unknown>,
        attributeNames?: Record<string, string>,
    ): Promise<boolean> {
        const validated = this.validate(item, "putConditional")
        return this.db.putConditional(this.tableName, validated, conditionExpression, values, attributeNames)
    }

    /**
     * For composite-key tables, override the signature to tighten the
     * sk type:
     *
     *   override async delete(taskId: tTaskId, messageId: tMessageId) {
     *       return super.delete(taskId, messageId)
     *   }
     */
    async delete(pk: T[PK], sk?: unknown): Promise<void> {
        await this.db.delete(this.tableName, this.buildKey(pk, sk))
    }

    /**
     * `keyCondition` uses ExpressionAttributeValues placeholders (`:foo`);
     * pass the values map alongside. For non-PK queries, supply the GSI
     * name as `indexName`. For a PK lookup-by-equality, prefer `get()`.
     *
     * Subclasses typically wrap this in typed helpers — e.g.
     * `getByOrgId(orgId: tOrgId)` does the right query under the hood.
     */
    async query(
        indexName: string | undefined,
        keyCondition: string,
        values: Record<string, unknown>,
    ): Promise<T[]> {
        return this.db.query<T>(this.tableName, indexName, keyCondition, values)
    }

    /**
     * Like `query` but expects 0 or 1 result — typically a unique-index
     * lookup (`username-index`, etc.). Internally limits the DDB scan to
     * one row; returns the row or `undefined`. Use this instead of
     * `(await query(...))[0]` so the limit reaches the wire.
     */
    async queryOne(
        indexName: string | undefined,
        keyCondition: string,
        values: Record<string, unknown>,
    ): Promise<T | undefined> {
        const rows = await this.db.query<T>(this.tableName, indexName, keyCondition, values, {limit: 1})
        return rows[0]
    }

    async scan(): Promise<T[]> {
        return this.db.scan<T>(this.tableName)
    }

    private buildKey(pk: T[PK], sk: unknown): Record<string, unknown> {
        const key: Record<string, unknown> = {[this.pkField]: pk}
        if (this.skField !== undefined) {
            if (sk === undefined) {
                throw new Error(
                    `${this.tableName}: composite-key table requires sort-key value (field "${this.skField}")`,
                )
            }
            key[this.skField] = sk
        }
        return key
    }

    private validate(item: T, op: string): T {
        const result = this.schema.safeParse(item)
        if (result.success === false) {
            const id = (item as Record<PK, unknown>)[this.pkField]
            throw new Error(
                `${this.tableName}.${op}: schema validation failed for ${id}: ` +
                JSON.stringify(result.issues),
            )
        }
        return result.value
    }
}
