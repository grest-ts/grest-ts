# Job Patterns

When `@grest-ts/job` fits, when a message queue does, and how to move from one to the other.

## Two Ways to Find Work

**Schedule-driven (`@grest-ts/job`).** On an interval, query the state for what needs work, and work on it. The state is the source of truth: a row that wasn't processed, or failed, is still there on the next run. There is nothing to lose, retry or dead-letter.

```typescript
// The data set is "orders that still need syncing". A processed order drops out of it.
async getDataSet(limit: number) {
    return this.orders.listPendingSync(limit)
}
```

**Event-driven (a message queue).** Something publishes a message per unit of work, and workers consume them. Latency is low and throughput scales with workers, but a message is the only record of the work: queues need retries, a dead-letter queue and idempotent consumers to avoid losing or doubling it.

## Choosing

Use `@grest-ts/job` when:

- the work follows from state you already store (expired rows, unsynced records, missing derived data)
- minutes of latency are fine
- the volume fits a batch every interval (thousands of rows per run, not millions)
- you want no infrastructure beyond your database

Use a message queue when:

- work is triggered by events and must start within seconds
- throughput needs more workers than a batch per interval allows
- work comes from other services
- per-entity ordering matters at scale (partitioned queues)

Many systems use both: a queue for the hot path, and a job that sweeps for whatever the queue missed.

## Lock Modes as Patterns

| Pattern | `@grest-ts/job` |
|---|---|
| One worker, one row at a time (ordered, or a rate-limited API) | `lock: "exclusive"`, `parallel: 1` |
| One worker, rows concurrently (I/O-bound work) | `lock: "exclusive"`, `parallel: N` |
| All instances share a large data set | `lock: "item"`: a lock per row |
| The data store claims rows itself | `lock: "none"`, with a conditional status update in `processRow` |

`parallel` doubles as a simple rate limit. For a token-bucket limit on an external API, keep `parallel` low and pace inside `processRow`.

## Make Rows Safe to Run Twice

A row can be processed twice: a run is stopped mid-row, a lock is lost after a long pause, or `item` mode's re-check races another instance. Make `processRow` idempotent:

- write the result conditionally (`putConditional` on a version or status), so a second run is a no-op
- or record what was done (an id per side effect) and skip it when present

A row that keeps failing stays in the data set and is retried every run. If that is a problem, count attempts on the row and leave it out of `getDataSet` past a limit (a dead-letter state in your own table).

## The Outbox Relay

Writing to the database and publishing a message can't be atomic. Write the message to an outbox table in the same transaction, and relay it with a job:

```typescript
await db.transaction(async tx => {
    await tx.insert(orders, order)
    await tx.insert(outbox, {id: newId(), topic: "order-created", data: {orderId: order.id}})
})

class OutboxRelayJob extends GGJob<OutboxRow> {
    // ...constructor: name "outbox-relay", lock "exclusive", intervalMs 5_000
    getDataSet(limit: number) {
        return this.outbox.listUnsent(limit)
    }
    async processRow(row: OutboxRow) {
        await this.queue.publish(row.topic, row.data)
        await this.outbox.markSent(row.id)
    }
}
```

The relay delivers at least once (a crash between publish and `markSent` publishes again), so consumers dedupe by the message id. This is also the way to grow out of a job: keep the outbox, and move the work itself to queue consumers.

## Outgrowing a Job

Signs it's time for a queue or a workflow engine:

- runs take most of their interval (the runner warns when a run exceeds 70% of it)
- data sets come back full every run (warned near `limit`), and `maxExtraRuns` isn't catching up
- the work has many steps with compensation on failure: a workflow engine (e.g. Temporal) models that better than rows with status columns
