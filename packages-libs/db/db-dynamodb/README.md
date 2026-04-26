<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/db-dynamodb

Thin wrapper around the [AWS SDK v3 DynamoDB client](https://github.com/aws/aws-sdk-js-v3) to make it easier to use within grest-ts. Handles client lifecycle, configuration via `@grest-ts/config`, service registration via `@grest-ts/locator`, and schema-validated table writes via `@grest-ts/schema`.

The package gives you three layers:

- **`GGDynamoDbConfig`** — config wrapper. Defines the `GGResource` (region/endpoint) and `GGSecret` (credentials) keys for one DynamoDB connection. Use inside `GGConfig.define()`.
- **`GGDynamoDb`** — the connection. Owns the SDK client, exposes raw `get` / `put` / `query` / `scan` / `delete` primitives plus a conditional-put helper.
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
// GET
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

// SCAN — small tables / admin only
const all = await db.scan<UserRow>("users")
```

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

Schema validation is applied on `put` and `putConditional` only. Reads (`get`, `query`, `scan`) return whatever the table holds, cast to `T`. This is deliberate — it keeps the read path fast and avoids forcing a migration when a column is added. If you need read-side validation, wrap the call site.

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
