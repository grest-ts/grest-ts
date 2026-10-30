<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/lock-dynamodb

A [`GGLock`](@pkg/lock) on DynamoDB, shared by every instance that uses the same table. Each call is one conditional write, so concurrent acquires have exactly one winner.

```typescript
import {GGDynamoDbLock} from "@grest-ts/lock-dynamodb"
import {withLock, newLockOwner} from "@grest-ts/lock"

class MyRuntime extends GGRuntime {
    protected compose(): void {
        const db = MyConfig.db.newDynamoDb()
        const lock = new GGDynamoDbLock(db, {tableName: "my-service.locks"})
        // pass it to a GGJobRunner, or use withLock(lock, ...) directly
    }
}
```

It writes through the `GGDynamoDb` from [`@grest-ts/db-dynamodb`](@pkg/db-dynamodb), so it follows that connection's config, and each row is validated against `IsGGDynamoDbLockRow`.

## The Table

Create it from `GGDynamoDbLock.tableDefinition(tableName)` (a string `id` hash key), and enable DynamoDB TTL on `GGDynamoDbLock.TTL_ATTRIBUTE` (`expiresAtSec`):

```typescript
import {CreateTableCommand, UpdateTimeToLiveCommand} from "@aws-sdk/client-dynamodb"

const raw = db.getRawClient()
await raw.send(new CreateTableCommand({...GGDynamoDbLock.tableDefinition("my-service.locks"), BillingMode: "PAY_PER_REQUEST"}))
await raw.send(new UpdateTimeToLiveCommand({
    TableName: "my-service.locks",
    TimeToLiveSpecification: {AttributeName: GGDynamoDbLock.TTL_ATTRIBUTE, Enabled: true},
}))
```

| Attribute | Meaning |
|---|---|
| `id` | Lock id |
| `owner` | Holder |
| `lockedUntil` | Epoch ms; the lock is free from this instant |
| `expiresAtSec` | `lockedUntil` + a day, in epoch seconds: rows nobody released are deleted by TTL |

Lease times come from the caller's clock, so instance clocks must agree to well within the TTL.
