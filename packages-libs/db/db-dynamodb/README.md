<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/db-dynamodb

Thin wrapper around the [AWS SDK v3 DynamoDB client](https://github.com/aws/aws-sdk-js-v3) to make it easier to use within grest-ts. Handles client lifecycle, configuration via `@grest-ts/config`, service registration via `@grest-ts/locator`, and schema-validated table writes via `@grest-ts/schema`.

The package gives you three layers:

- **`GGDynamoDbConfig`** — config wrapper. Defines the `GGResource` (region/endpoint) and `GGSecret` (credentials) keys for one DynamoDB connection. Use inside `GGConfig.define()`.
- **`GGDynamoDb`** — the connection. Owns the SDK client, exposes raw `get` / `put` / `query` / `queryPage` / `scan` / `scanPage` / `delete` primitives plus conditional put and delete helpers.
- **`GGDynamoDbTable<T, PK>`** — schema-bound table gateway. Validates against a `GGSchema` on every write. Subclass it to add typed helpers for an entity (e.g. `getByOrgId`).

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

## Schema-Bound Tables

For application code, prefer `GGDynamoDbTable`. It binds a table to a schema and validates every write — shape mistakes throw at the boundary instead of becoming silent DynamoDB corruption.

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

`GGDynamoDb.getRawClient()` returns a fresh low-level `DynamoDBClient` (no DocumentClient marshalling). Use it for `CreateTable` / `DescribeTable` / etc. — operations the document layer doesn't cover. It reads config at call time, so it works before `start()` has run, which is what seed scripts need to create tables before any data exists.

```typescript
import { CreateTableCommand } from "@aws-sdk/client-dynamodb"

const raw = db.getRawClient()
await raw.send(new CreateTableCommand({ /* ... */ }))
```

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
