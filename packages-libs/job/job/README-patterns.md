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

## Heavy Work: a Job Feeds a Queue

A job runs on one instance at a time, so its throughput is one instance's. When there are many items, or each one is slow, keep the job as the collector and move the work to a queue:

```
oneInstance job (every interval)                     SQS                consumers (any number)
getDataSet → rows that need work  ──publish each──▶  queue  ──▶  handler(item): do the work
processRow → publish, mark the row queued            (retries, DLQ)
```

- `processRow` publishes the item (e.g. with `@grest-ts/events`), then marks the row as queued, so the next run doesn't publish it again. `getDataSet` skips queued rows, unless they have been queued too long: then the job republishes them, which makes it the safety net for lost messages.
- Publish before marking: a crash in between publishes twice rather than never. Queues deliver at least once anyway, so handlers must be idempotent.
- Consumers scale on their own and each message reaches one of them, so there's no contention between instances.

Signs a job needs this: runs take most of their interval (the runner warns past 70% of it), or data sets come back full every run and `maxExtraRuns` isn't catching up.

`parallel` covers I/O-bound work within one run, and doubles as a simple rate limit.

## Make Rows Safe to Run Twice

A row can be processed twice: a run is stopped mid-row and picked up again, or a lock is lost after a long pause while the next holder starts. Make every step idempotent:

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
    // ...constructor: super({name: "outbox-relay", settings: MyConfig.jobs.outboxRelay})
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

- many items or slow items: a job feeding a queue, as above
- many steps with compensation on failure: a workflow engine (e.g. Temporal) models that better than rows with status columns
