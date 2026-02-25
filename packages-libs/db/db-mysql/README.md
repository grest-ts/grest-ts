<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/db-mysql

Thin wrapper around [mysql2](https://github.com/sidorares/node-mysql2) to make it easier to use within grest-ts. Handles connection pooling, lifecycle management, configuration via `@grest-ts/config`, and service registration via `@grest-ts/locator`.

## Defining the Config

Database configuration is defined inside `GGConfig.define()`. Each `GGMysqlConfig` creates two config keys: a `GGResource` for host/connection info and a `GGSecret` for credentials.

```typescript
// MyConfig.ts
import { GGConfig } from "@grest-ts/config"
import { GGMysqlConfig } from "@grest-ts/db-mysql"

export const MyConfig = GGConfig.define("/my-service/", () => ({
    db: new GGMysqlConfig("main-db"),
    // optionally pass a schema file for testkit cloning
    // db: new GGMysqlConfig("main-db", resolvePath("./schema/init.sql", import.meta.url)),
}))
```

## Providing Config Values

### Local development

Use `GGConfigStoreLocal` with `createLocalConfig` for type-safe local values:

```typescript
// config/local.ts
import { createLocalConfig } from "@grest-ts/config"
import { MyConfig } from "../MyConfig"

export default createLocalConfig(MyConfig, {
    db: {
        host: { database: "my_database", host: "localhost", port: 3306 },
        user: { username: "root", password: "root" },
    }
})
```

### Production

Use a production-safe store (e.g. AWS Secrets Manager). The store interface is the same, only the backing implementation changes.

## Wiring in Runtime

Create the config locator and database pool inside your runtime's `compose()` method:

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

        // 2. Create database pool (registers with GGLocator, starts/stops with runtime)
        const db = MyConfig.db.newMysqlPool()

        // 3. Use it in your services
        const userService = new UserService(db)
    }
}
```

The pool automatically:
- Registers with `GGLocator` for dependency injection
- Starts on `runtime.start()` and tears down on shutdown
- Watches for config changes and reconnects when host or credentials update

## Queries

```typescript
// SELECT - returns typed rows
const users = await db.query<UserRow[]>("SELECT id, name FROM users WHERE active = ?", [1])

// INSERT/UPDATE/DELETE - returns ResultSetHeader
const result = await db.execute("INSERT INTO users (name) VALUES (?)", ["Alice"])
console.log(result.insertId, result.affectedRows)
```

## Transactions

```typescript
// Automatic transaction management
const orderId = await db.runInTransaction(async (conn) => {
    const result = await conn.execute("INSERT INTO orders (user_id) VALUES (?)", [userId])
    await conn.execute("INSERT INTO order_items (order_id, product_id) VALUES (?, ?)", [result.insertId, productId])
    return result.insertId
})

// Manual transaction control
const conn = await db.getConnection()
try {
    await conn.beginTransaction()
    await conn.execute("UPDATE accounts SET balance = balance - ? WHERE id = ?", [amount, fromId])
    await conn.execute("UPDATE accounts SET balance = balance + ? WHERE id = ?", [amount, toId])
    await conn.commit()
} catch (err) {
    await conn.rollback()
    throw err
} finally {
    conn.release()
}
```

## Config Shape Reference

Host config (`GGResource`):

| Field | Type | Default | Description |
|---|---|---|---|
| `database` | `string` | *required* | Database name |
| `host` | `string?` | `"localhost"` | Server hostname |
| `port` | `number?` | `3306` | Server port |
| `connectionLimit` | `number?` | `20` | Max pool connections |

User config (`GGSecret`):

| Field | Type | Description |
|---|---|---|
| `username` | `string?` | Database username |
| `password` | `string?` | Database password |

## Testkit

The package includes a testkit entrypoint (`@grest-ts/db-mysql/testkit`) with utilities for schema cloning and test database management.

```typescript
import { GGTest } from "@grest-ts/testkit"

// Clone database for isolated test - creates a fresh copy per test
GGTest.with(MyConfig.db).clone()

// Clone with seed data
GGTest.with(MyConfig.db).clone("seed.sql")

// Clone with explicit source config (when no defaults are set)
GGTest.with(MyConfig.db).clone({ from: mysqlLocalConfig, seedFiles: ["seed.sql"] })
```
