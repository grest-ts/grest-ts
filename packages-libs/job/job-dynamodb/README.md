<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/job-dynamodb

A DynamoDB `GGJobLock` for [`@grest-ts/job`](@pkg/job), so the instances of a service share their job locks. Every operation is a single conditional write, so concurrent acquires have exactly one winner. It is also a plain distributed `GGLock` (see [`@grest-ts/lock`](@pkg/lock)).

## Usage

```typescript
import {GGJobRunner} from "@grest-ts/job"
import {GGJobDynamoDbLock} from "@grest-ts/job-dynamodb"

class MyRuntime extends GGRuntime {
    protected compose(): void {
        const db = MyConfig.db.newDynamoDb()

        new GGJobRunner({lock: new GGJobDynamoDbLock(db, {tableName: "my-service.job-locks"})})
            .add(new MyJob())
    }
}
```

The first argument is anything with `getRawClient()`, typically a `GGDynamoDb` from [`@grest-ts/db-dynamodb`](@pkg/db-dynamodb). The client is read on every call, so it works before the runtime has connected and follows a reconnect after a config change.

## The Table

Create it from `GGJobDynamoDbLock.tableDefinition(tableName)` (a `CreateTableCommandInput`: a string `id` hash key), with the billing mode of your choice:

```typescript
import {CreateTableCommand} from "@aws-sdk/client-dynamodb"

await db.getRawClient().send(new CreateTableCommand({
    ...GGJobDynamoDbLock.tableDefinition("my-service.job-locks"),
    BillingMode: "PAY_PER_REQUEST",
}))
```

Enable DynamoDB TTL on the `expiresAtSec` attribute. A held lock carries it, set to a day past its lease, so the row of a holder that crashed (an `item` row lock, typically) is eventually deleted. A finished `exclusive` run keeps one row per job with its `lastRunAt`.

| Attribute | Set while | Meaning |
|---|---|---|
| `id` | always | Lock id: the job name, or `<job>#<rowKey>` for an `item` row lock |
| `owner`, `lockedUntil` | held | Holder and lease end (ms) |
| `expiresAtSec` | held | TTL attribute |
| `lastRunAt` | after an `exclusive` run | When the last finished run started (ms) |

Lease times come from the instance clock (`Date.now()`, or the `now` option), so instance clocks must agree to well within `timeoutMs`.
