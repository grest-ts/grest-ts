<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/db-dynamodb

Thin wrapper around the [AWS SDK v3 DynamoDB client](https://github.com/aws/aws-sdk-js-v3) to make it easier to use within grest-ts. Handles client lifecycle, configuration via `@grest-ts/config`, service registration via `@grest-ts/locator`, and schema-validated table writes via `@grest-ts/schema`.

The package gives you three layers:

- **`GGDynamoDbConfig`** — config wrapper. Defines the `GGResource` (region/endpoint) and `GGSecret` (credentials) keys for one DynamoDB connection. Use inside `GGConfig.define()`.
- **`GGDynamoDb`** — the connection. Owns the SDK client, exposes raw `get` / `put` / `query` / `queryPage` / `scan` / `scanPage` / `delete` primitives plus conditional put and delete helpers.
- **`GGDynamoDbTableSpec` + `GGDynamoDbTypedTable`** — one declaration per table (schema, keys, derived index attributes, indexes) from which writes derive their index keys, queries are typed per index, and the `CreateTable` input is generated. Prefer it for new tables; see [Typed Tables](#typed-tables).
- **`GGDynamoDbTable<T, PK>`** — schema-bound table gateway with string queries. Validates against a `GGSchema` on every write. Subclass it to add typed helpers for an entity (e.g. `getByOrgId`).

## Defining the Config

DynamoDB configuration is defined inside `GGConfig.define()`. Each `GGDynamoDbConfig` creates two config keys: a `GGResource` for region/endpoint and a `GGSecret` for credentials.

```typescript
// MyConfig.ts
import { GGConfig } from "@grest-ts/config"
import { GGDynamoDbConfig } from "@grest-ts/db-dynamodb"

export const MyConfig = GGConfig.define("/my-service/", () => ({
    db: new GGDynamoDbConfig("main-db"),
}))
```

## Providing Config Values

### Local development

Use `GGConfigStoreLocal` with `createLocalConfig` for type-safe local values. Point `endpoint` at a local DynamoDB (e.g. dynamodb-local on `http://localhost:8000`); credentials can be left blank — the package injects placeholders so the SDK does not hang reaching for IMDS.

```typescript
// config/local.ts
import { createLocalConfig } from "@grest-ts/config"
import { MyConfig } from "../MyConfig"

export default createLocalConfig(MyConfig, {
    db: {
        host: { region: "eu-north-1", endpoint: "http://localhost:8000" },
        user: { accessKeyId: undefined, secretAccessKey: undefined },
    }
})
```

### Production

Use a production-safe store (e.g. AWS Secrets Manager). The store interface is the same, only the backing implementation changes. In production you typically leave `endpoint` empty and omit credentials so the SDK uses its default credential chain (IAM role on EC2/Beanstalk, env vars, shared profile).

## Wiring in Runtime

Create the config locator and DynamoDB client inside your runtime's `compose()` method:

```typescript
// my-service.ts
import { GGConfigLocator, GGConfigStoreLocal, GGResource, GGSecret } from "@grest-ts/config"
import { MyConfig } from "./MyConfig"
import localConfig from "./config/local"

class MyRuntime extends GGRuntime {
    protected compose(): void {
        // 1. Wire config store
        new GGConfigLocator(MyConfig)
            .add([GGResource, GGSecret], new GGConfigStoreLocal(MyConfig, localConfig))

        // 2. Create DynamoDB client (registers with GGLocator, starts/stops with runtime)
        const db = MyConfig.db.newDynamoDb()

        // 3. Use it in your services
        const userService = new UserService(db)
    }
}
```

The client automatically:
- Registers with `GGLocator` for dependency injection
- Starts on `runtime.start()` (verifies access with a cheap `ListTables` call) and tears down on shutdown
- Watches for config changes and rebuilds the SDK client when region, endpoint, or credentials change

## Raw Primitives

```typescript
// GET — strongly consistent by default (see Read Consistency)
const user = await db.get<UserRow>("users", { userId: "u_123" })

// PUT
await db.put("users", { userId: "u_123", name: "Alice" })

// Conditional PUT — returns false if condition fails (another writer beat us)
const ok = await db.putConditional(
    "users",
    { userId: "u_123", name: "Alice", version: 2 },
    "#v = :expected",
    { ":expected": 1 },
    { "#v": "version" }, // attributeNames needed for reserved keyword "version"
)

// QUERY (PK or GSI)
const rows = await db.query<UserRow>(
    "users",
    "by-org-index",          // GSI name; pass undefined for the base table
    "orgId = :org",
    { ":org": "o_abc" },
)

// DELETE
await db.delete("users", { userId: "u_123" })

// Conditional DELETE — returns false if the condition fails
await db.deleteConditional("users", { userId: "u_123" }, "#v = :expected", { ":expected": 2 }, { "#v": "version" })

// SCAN — small tables / admin only
const all = await db.scan<UserRow>("users")
```

## Paging

DynamoDB caps a single `Query` / `Scan` response at **1MB** however many rows match, handing back a `LastEvaluatedKey` instead of an error. A single command is therefore never proof of a complete result.

`query` and `scan` follow that continuation to the end, so they return every matching row. Because "every row" has no natural bound, they **throw** past 10 000 rows rather than quietly loading a result set that large — that is the signal to page explicitly instead:

```typescript
// Whole result set — for aggregates (counts, sums) that a partial set makes wrong.
const all = await db.query<UserRow>("users", "by-org-index", "orgId = :org", { ":org": "o_abc" })

// One page at a time — for a listing whose caller pages (an API endpoint, a UI list).
const page = await db.queryPage<UserRow>(
    "users",
    "by-org-index",
    "orgId = :org",
    { ":org": "o_abc" },
    { limit: 30, descending: true },   // descending walks the sort key backwards
)
page.items    // UserRow[]
page.cursor   // pass back as `cursor`; undefined once the index is exhausted
```

The `cursor` is opaque — hand it to a client and take it back, don't build one.

**Picking between them:** if the caller renders a list, use `queryPage`. If a partial answer would be *wrong* rather than just short — a total, a uniqueness check, a cleanup sweep — use `query` and let the cap tell you when the data outgrew the approach. A GSI partitioned so widely that one partition can hold an unbounded number of rows (per-org, per-tenant) is usually the real problem the cap is pointing at.

## Reserved Words and Filters

`names` maps `#placeholder`s to attribute names, for attributes that are DynamoDB reserved words (`status`, `name`, `version`, ...). `filter` adds a `FilterExpression`, sharing the same `values` and `names` as the key condition. Both work on `query` / `queryPage` / `scan` / `scanPage`; scans take their `values` in the options.

```typescript
const pending = await db.query<JobRow>(
    "jobs",
    "by-owner-status-index",
    "ownerId = :o AND #s = :s",                  // sort key named `status`
    { ":o": "o_abc", ":s": "PENDING", ":p": 3 },
    { names: { "#s": "status" }, filter: "priority >= :p" },
)

const stale = await db.scan<JobRow>("jobs", {
    filter: "#s = :s",
    names: { "#s": "status" },
    values: { ":s": "STALE" },
})
```

A filter runs **after** DynamoDB has read the rows:

- **It trims the payload, not the cost.** Filtered-out rows are still read and billed. Bounded, cheap access comes from key design — a key or index that selects the rows — not from a filter.
- **`Limit` applies before the filter.** On `queryPage` / `scanPage`, `limit` counts rows *read*, so a page can come back with fewer items than `limit` — even empty — while matches exist further on. Follow the `cursor`, not the item count.
- **`query` / `scan` count matches instead.** With a filter they send no `Limit`, read whole pages, and stop once `limit` matches are found. The 10 000-row cap counts returned rows too. A sparse filter can therefore read far more rows than it returns — up to the whole partition (or table, for `scan`).

## Read Consistency

DynamoDB reads are eventually consistent unless asked otherwise: a read shortly after a write can return the previous item. A strongly consistent read sees every write acknowledged before it, at **2× the read capacity** (RCU / request units).

- **`get` is strongly consistent by default.** The common "get, then `putConditional` on a version" pattern would otherwise act on a stale item and fail the condition right after a write. Opt out where staleness is fine and cost matters: `db.get(table, key, { consistentRead: false })`, `users.get(id, undefined, { consistentRead: false })`.
- **`query` / `queryPage` / `scan` / `scanPage` are eventually consistent by default.** Pass `{ consistentRead: true }` to change that. It works on the base table and on local secondary indexes; global secondary indexes are always eventually consistent, and DynamoDB rejects the request with a `ValidationException` if you ask.

## Typed Tables

`GGDynamoDbTableSpec.define` declares a table once: its row schema, keys, the attributes the library derives for index keys, and its indexes. `new GGDynamoDbTypedTable(db, spec)` binds it to a connection.

```typescript
import { GGDynamoDbTableSpec, GGDynamoDbTypedTable, type GGDynamoDbTableOf } from "@grest-ts/db-dynamodb"

export const WorkspacesTable = GGDynamoDbTableSpec.define({
    name: "workspaces",
    schema: IsWorkspace,                       // an IsObject schema; derived attributes are not in it
    pk: "workspaceId",
    derived: d => ({
        orgUser: d.join("orgId", "userId"),                                          // "org#user"
        liveOrg: d.join("orgId").when(["status"], r => r.status !== "deleted"),       // sparse
        flowPending: d.flag(["pendingOp"], r => !!r.pendingOp),                       // "1" or absent
        activeUntil: d.number(["endedAt"], r => r.endedAt ?? Number.MAX_SAFE_INTEGER),
    }),
    indexes: {
        byOrgUser: { pk: "orgUser", sk: "status" },                                  // named orgUser-status-index
        liveByOrg: { name: "liveOrg-createdAt-index", pk: "liveOrg", sk: "createdAt", projection: ["name", "status"] },
        pendingFlows: { pk: "flowPending", projection: "KEYS_ONLY" },
    },
})

// A store extends the table: get / put / update / delete / query / index / tx are inherited, the store adds its own.
export class WorkspaceStore extends GGDynamoDbTypedTable.of(WorkspacesTable) {
    listForMember(orgId: string, userId: string) {
        return this.index.byOrgUser.query({ orgId, userId }, { sk: { lt: "deleted" } })
    }
}
const workspaces = new WorkspaceStore(db)
await workspaces.get("w-1")              // a table keyed on one plain field also takes the bare value
```

`new GGDynamoDbTypedTable(db, spec)` works too, for a table used as is; `GGDynamoDbTableOf<typeof Spec>` names its type.

### Derived attributes

A derived attribute is computed from the row on **every** write path — `put`, `putMany`, `update`, `tx.*` — so application code never computes an index key. Each builder names the fields it reads, and its function sees only those. Returning `undefined` (or `""`, which DynamoDB can't index) leaves the attribute off the row, which keeps the row out of every index keyed on it (a sparse index).

| Builder | Stored | Queried by |
|---|---|---|
| `d.join("a")` | `a`'s value | `{a}` |
| `d.join("a", "b")` | `"<a>#<b>"` (absent while a part is undefined) | `{a, b}` |
| `.when(fields, test)` on a join | absent while `test` is false | as the join |
| `d.flag(fields, test)` | `"1"` while `test` holds | nothing: `index.x.query()` |
| `d.string(fields, fn)` / `d.number(fields, fn)` | `fn`'s result | its `fields` |

A `join` sorts as a string: `"10"` before `"9"`. When order matters, build the value with `d.string` (e.g. pad numbers). A part containing `#` is refused, as it would let two rows share one value.

A derived name may not also be a schema field, nor read a `sets` field.

### Rows come back in the schema's shape

Reads return the schema's fields and nothing else: derived attributes, and attributes the schema no longer has (a field you removed), stay on the stored item out of the app's sight. That decides what writes keep:

- `update` writes only the fields it is given, so everything else on the item, retired attributes included, stays. It refuses a field the schema doesn't have.
- `put` / `save` replace the whole item, so an item written from a read sheds its retired attributes.

**Before converting a table, make its schema the full stored shape** — every attribute a row carries that must survive, encrypted blobs and bookkeeping fields included. A `put` of a row read through a narrower schema erases the rest.

For a write or read that can't go through the table (a seed script, a raw command), `spec.withDerived(row)` adds the derived attributes and `spec.toRow(item)` gives the schema's shape.

### Table keys from parts

The table's own `pk` / `sk` may be derived too, so a composite key is never assembled by hand. Rows are then addressed by the key's inputs, which are fixed once a row exists: `update` refuses them, and treats them as known inputs of other derived attributes. A table key can't be sparse: no `flag`, no `.when`, no optional `join` part.

```typescript
const UsageTable = GGDynamoDbTableSpec.define({
    name: "usage", schema: IsUsage, pk: "userId", sk: "providerDay",
    derived: d => ({ providerDay: d.join("orgId", "provider", "day") }),
})
await usage.get({ userId, orgId, provider, day })
await usage.query({ userId }, { sk: { prefix: { orgId } } })    // begins_with "<orgId>#": the leading parts
```

A `join` key maps back to exactly one set of parts. A `d.string` / `d.number` key may not (`second: d.number(["at"], r => Math.floor(r.at / 1000))` puts many `at`s on one key), so `get` / `getMany` only return a row holding the key's inputs, and `update`, `delete` and `tx` items condition on them.

An index with a KEYS_ONLY / INCLUDE projection also projects the table key's inputs, so a row it returns can be addressed. `backfillPage` never rewrites a key: a different value would be a different row.

### Queries

Each index is `table.index.<key>`, with its key input and sort-key condition typed from the spec. Index and expression strings never appear in application code; every attribute goes through a placeholder, so reserved words (`status`, `name`) just work.

```typescript
await table.index.byOrgUser.query({ orgId, userId }, { sk: { lt: "deleted" } })
await table.index.liveByOrg.queryPage({ orgId }, { descending: true, limit: 30, cursor })
await table.index.pendingFlows.queryOne()
await table.query({ streamId }, { sk: { between: [10, 20] } })   // the table's own key, for a table with a sort key
```

Sort-key conditions: `eq`, `lt`, `lte`, `gt`, `gte`, `between: [a, b]`, `beginsWith` on string keys, and `prefix` (leading parts) on a `join` key of several parts. On a derived sort key the operands may be its inputs: `{ between: [{ at: from }, { at: to }] }`. `consistentRead` is offered on the table's own key and local indexes only: a GSI is always eventually consistent.

`query` drains every page (capped, as in [Paging](#paging)) and accepts a `filter`, on anything but the queried key (DynamoDB refuses that: use `sk`). `queryPage` takes no filter, because DynamoDB's `Limit` counts rows before the filter and a filtered page could come back short or empty while matches remain. A cursor handed back to another query throws `GGDynamoDbCursorError`, as a malformed one does.

Rows are typed by the index's projection: `"ALL"` (default) returns the row; `"KEYS_ONLY"` the table and index key fields; a list (DynamoDB's INCLUDE) those plus the listed fields. Share a projection list `as const` to keep its literal types.

### Writes and conditions

```typescript
await table.put(row)                                              // validates, derives, writes the whole row
await table.put(row, { if: { status: { eq: "running" } } })      // false when the condition fails
await table.create(row)                                           // only when no row has the key yet; false if one has
await table.take(key)                                             // deletes and returns the old row, atomically; undefined if none
await table.update({ workspaceId }, { name: "x" })                // the updated row, or undefined
await table.delete({ workspaceId }, { if: { version: { eq: 3 } } })
await table.getMany([{ workspaceId: a }, { workspaceId: b }])   // in the keys' order; missing rows skipped
await table.putMany(rows)                                         // 25 per request; no conditions, not atomic
await table.deleteMany(keys)
await table.scan({ filter: { status: { eq: "running" } } })
```

Conditions are typed by field, one operator each: `eq`, `ne`, `exists`, `in: [...]`, `lt` / `lte` / `gt` / `gte` / `between` (strings and numbers), `beginsWith` and `contains` (a substring, or a list's or set's element), and `size: { ... }` (a string's length, or an element count). Several fields are AND-ed, `anyOf: [...]` to OR whole conditions and `allOf: [...]` to AND them (for two conditions on one field). As in DynamoDB, `ne` holds on a row without the field; `allOf: [{ f: { exists: true } }, { f: { ne: v } }]` requires it.

### Partial updates

`update(key, fields, opts)` sets `fields` on an existing row; a field given as `undefined` is removed. A derived attribute none of whose inputs are in `fields` is left alone. One whose inputs are touched is rewritten in the same write, but only from values the write proves are on the row:

- inputs in `fields`,
- inputs pinned by a top-level `eq` (or `exists: false`) in `opts.if`,
- inputs read from `opts.current`, the row the caller read — the update then lands only while those inputs are unchanged.

If an input is none of these, `update` throws before writing. So a concurrent change to an input fails the update instead of leaving a stale key behind. `update` returns `undefined` when the row is missing, `opts.if` fails, or an input taken from `opts.current` changed: re-read and retry.

```typescript
// liveOrg reads orgId and status; current supplies orgId and pins it
await table.update({ workspaceId }, { status: "deleted" }, { current: row, if: { version: { eq: row.version } } })
// the condition pins deactivatedAt, which the flag reads alongside deactivationHandledFor
await users.update({ userId }, { deactivationHandledFor: at }, { if: { deactivatedAt: { eq: at } } })
```

### Counters, sets, upserts and partial writes

`opts.add` adds atomically to a number field (from 0 when absent); `opts.delete` removes elements from a set. Array fields listed in the spec's `sets` (optional ones) are stored as DynamoDB sets — unique elements, atomic `add` / `delete`, no attribute when empty — and read back as arrays. `opts.upsert` creates the row when it is missing instead of returning `undefined`. Because it may create the row, `fields`, `setIfMissing`, `add` and the key must cover every required field; it writes every derived attribute, so their inputs must be known — including optional ones, given as `undefined` when the row has none; and it can't take `opts.current`.

```typescript
const Usage = GGDynamoDbTableSpec.define({ name: "usage", schema: IsUsage, pk: "userId", sk: "day" })
await usage.update({ userId, day }, { lastAt: Date.now() }, { upsert: true, add: { requests: 1, seconds } })

const Workspaces = GGDynamoDbTableSpec.define({ ..., sets: ["lockedOutBy"] })
await workspaces.update({ workspaceId }, {}, { add: { lockedOutBy: [key] }, if: { status: { ne: "deleted" } } })
```

More partial writes, each atomic in the one `UpdateItem`:

- `setIfMissing: { createdAt: now }` sets a field only where the row has none (`if_not_exists`), e.g. on an upsert.
- `append: { history: [entry] }` appends to a list field (`list_append`), creating it when absent.
- `merge: { limits: { daily: 5, monthly: undefined } }` sets keys inside a map field and removes the `undefined` ones, leaving its other keys. The map must exist; `update` throws when it doesn't.
- Arithmetic is `add`, with a negative number to subtract.

A derived attribute can't read a field changed by `add`, `delete`, `setIfMissing`, `append` or `merge`: the write doesn't know the result, so `update` throws.

### Optimistic locking

With `version: "version"` in the spec, the field counts the row's writes: every write — `put`, `create`, `update`, `putMany`, `tx.*` — stores it plus one, and nothing writes it directly. `save(row)` writes while the stored version is still `row.version` and returns the row as written, or `undefined` when another write got there first: re-read and retry. `update(key, fields, { expectVersion: n })` does the same for a partial write. A row stored before the table had a version counts as version 0.

```typescript
const project = await projects.get(id)
const saved = await projects.save({ ...project, name })   // undefined: someone else saved first
```

### Transactions

`table.tx.put / create / update / delete / check` build items with the same validation, derivation and conditions; `db.transactWrite(items)` writes them all or none. When a condition cancels it, the result names the items whose condition failed:

```typescript
const result = await db.transactWrite([orders.tx.put(order), stock.tx.update({ sku }, { reserved }, { if: { version: { eq: v } } })])
if (!result.ok) result.conditionFailed   // [1]: the stock update's condition
```

### Tables for development and tests

Production tables belong to your infrastructure code (Terraform or similar), not to the service. For local development, tests and seed scripts, `GGDynamoDbDevTables.ensure` creates the tables a set of specs describes: a missing table with on-demand billing, a GSI a live table lacks (waiting for it to turn ACTIVE), and the spec's TTL. It only adds; an index the spec no longer declares is reported, never dropped. Nothing calls it on its own, and a service must not call it at startup.

```typescript
import { GGDynamoDbDevTables } from "@grest-ts/db-dynamodb/dev-tables"

await GGDynamoDbDevTables.ensure(rawClient, [WorkspacesTable, UsersTable], { log: console.log })
```

It lives on its own `dev-tables` entry, off the package's main one. What it can't fix — an index declared differently than the live one, TTL on another attribute, an LSI on an existing table — it reports through `log` and leaves as is.

In a test, `GGTest.with(cfg.db).clone({ host, tables: [WorkspacesTable, UsersTable] })` creates them in the suite's isolated database. A test, fixture or script holding an SDK client gets a `GGDynamoDb` over it with `GGDynamoDb.forClient(rawClient)`, so it writes through the typed table (derived keys included) instead of raw commands.

`spec.createTableInput()` returns the `CreateTableCommandInput` itself (keys, attribute types, GSIs and LSIs with their projections; no billing mode), to compare against the infrastructure code's definition. Attribute types come from the schema (string fields → `S`, number fields → `N`) or the builder.

An index with `local: true` is a local secondary index, on a table with a sort key: the table's `pk`, its own `sk`, `consistentRead` allowed. DynamoDB creates LSIs with the table only, and caps each partition (rows plus index entries) at 10 GB.

`ttl: "purgeAt"` names a number attribute holding a Unix time in seconds after which DynamoDB may delete the row, usually within days; reads still see it until then. It may be a field or a `d.number` derived attribute, so callers never compute it: `ttl: "purgeAt", derived: d => ({ purgeAt: d.number(["expiresAt"], r => Math.floor(r.expiresAt / 1000) + 30 * DAY_SEC) })`. DynamoDB enables TTL with a separate call: `GGDynamoDbDevTables.ensure` makes it, and `spec.timeToLiveInput()` returns its `UpdateTimeToLiveCommandInput`.

### Backfilling derived attributes

After adding an index or changing a key function, rewrite existing rows with `backfillPage`. It reads one page, recomputes every derived attribute, and rewrites only the rows that differ (`concurrency` at a time, default 10), each conditioned on the inputs it read being unchanged — a row another writer changed meanwhile is counted as a conflict and left to that writer, which derived its keys itself. A row whose key function throws is reported in `failed` and left alone. It is resumable from any returned cursor and tied to no job framework:

```typescript
let cursor: string | undefined
do {
    const page = await table.backfillPage({ cursor, limit: 200 })   // { scanned, rewritten, conflicts, failed, cursor }
    cursor = page.cursor
} while (cursor)
```

For a large table, run `totalSegments` workers, each with its own `segment` (0-based) and cursor. Run a backfill once every writer derives with the new spec. Attributes no longer in the spec are not removed; a DynamoDB error fails the page, which is safe to run again.

### Migrating from `GGDynamoDbTable`

Both classes share a `GGDynamoDb`, so tables move one at a time. A store that extended `GGDynamoDbTable` extends `GGDynamoDbTypedTable.of(spec)` instead and keeps its domain methods. Give derived attributes and indexes the names already on disk (`name` on an index, only where it differs from the default `<pk>[-<sk>]-index`) and the stored rows need no migration; check that the schema is the full stored shape (see [Rows come back in the schema's shape](#rows-come-back-in-the-schemas-shape)). Move every writer of a table at once: a writer left on `GGDynamoDbTable` would not derive the keys. For a command the typed table doesn't cover, `db.getDocumentClient()` returns the managed document client — keep such writes off derived attributes' inputs.

## Schema-Bound Tables

> Deprecated: declare the table with `GGDynamoDbTableSpec` and use `GGDynamoDbTypedTable` (see [Typed Tables](#typed-tables)).

`GGDynamoDbTable` binds a table to a schema and validates every write — shape mistakes throw at the boundary instead of becoming silent DynamoDB corruption.

```typescript
import { GGDynamoDbTable } from "@grest-ts/db-dynamodb"
import { IsObject, IsString, IsNumber } from "@grest-ts/schema"

const IsUser = IsObject({
    userId: IsString,
    orgId: IsString,
    name: IsString,
    version: IsNumber,
})
type User = typeof IsUser.infer

class UserTable extends GGDynamoDbTable<User, "userId"> {
    constructor(db: GGDynamoDb) {
        super(db, "users", IsUser, "userId")
    }

    // Typed helpers for index queries
    async getByOrgId(orgId: string): Promise<User[]> {
        return this.query("by-org-index", "orgId = :org", { ":org": orgId })
    }
}

const users = new UserTable(db)
await users.put({ userId: "u_1", orgId: "o_1", name: "Alice", version: 1 })
const u = await users.get("u_1")
```

### Partial Updates

`put` replaces the whole row, so a get-modify-put silently reverts any concurrent change to the fields it didn't mean to touch (and recreates a row deleted in between). `updateFields` writes only the given fields, onto the row only if it still exists, after validating them merged onto the row you read:

```typescript
const updated = await users.updateFields(current, { name: "Alicia" }) // undefined if the row is gone
```

### Composite Keys

Pass the sort-key field name as the fifth constructor argument. Override `get` / `delete` in subclasses to tighten the sort-key type:

```typescript
class TaskMessageTable extends GGDynamoDbTable<TaskMessage, "taskId"> {
    constructor(db: GGDynamoDb) {
        super(db, "task_messages", IsTaskMessage, "taskId", "messageId")
    }

    override async get(taskId: string, messageId: string) {
        return super.get(taskId, messageId)
    }

    override async delete(taskId: string, messageId: string) {
        return super.delete(taskId, messageId)
    }
}
```

### Single-Result Queries

For unique-index lookups (e.g. `username-index`), use `queryOne` so the limit reaches the wire:

```typescript
const user = await users.queryOne(
    "username-index",
    "username = :u",
    { ":u": "alice" },
)
```

## Admin / Table Creation

`GGDynamoDb.getRawClient()` returns a fresh low-level `DynamoDBClient` (no DocumentClient marshalling). Use it for `DescribeTable` and other operations the document layer doesn't cover. It reads config at call time, so it works before `start()` has run, which is what a seed script needs to create its tables with `GGDynamoDbDevTables.ensure` before any data exists.

## Reads Are Not Validated

Schema validation is applied on `put`, `putConditional` and `updateFields` only. Reads (`get`, `query`, `queryPage`, `scan`, `scanPage`) return whatever the table holds, cast to `T`. This is deliberate — it keeps the read path fast and avoids forcing a migration when a column is added. If you need read-side validation, wrap the call site.

## Config Shape Reference

Host config (`GGResource`):

| Field | Type | Description |
|---|---|---|
| `region` | `string` | AWS region (e.g. `eu-north-1`) |
| `endpoint` | `string?` | Custom endpoint URL (e.g. `http://localhost:8000` for dynamodb-local). Empty/undefined = real AWS |

User config (`GGSecret`):

| Field | Type | Description |
|---|---|---|
| `accessKeyId` | `string?` | AWS access key. Omit to use the SDK's default credential chain |
| `secretAccessKey` | `string?` | AWS secret key. Omit to use the SDK's default credential chain |

When both credential fields are missing, the SDK uses its default credential chain (IAM role on EC2/Beanstalk, env vars, shared profile). When `endpoint` is set but credentials are missing, placeholder credentials (`local`/`local`) are injected so the SDK does not hang on IMDS in dev.
