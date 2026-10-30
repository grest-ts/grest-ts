<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/job

Recurring batch work over a data set you own: cleanups, reconciliation, backfills, expiry sweeps, an outbox relay. A job runs every `intervalMs`, loads the rows that need work (`getDataSet`) and processes each one (`processRow`). Instances of a service coordinate through a [`GGLock`](@pkg/lock), so a job is safe to run on several of them.

**This is not a queue.** There is no `enqueue`: a job finds its work by querying state, so a row that is missed or fails is picked up on the next run. For units of work pushed from elsewhere, use a message queue. [Job patterns](./README-patterns.md) covers when to use which.

## Defining a Job

```typescript
import {GGJob} from "@grest-ts/job"

export class ExpiredSessionsJob extends GGJob<Session> {

    private readonly sessions: SessionTable

    constructor(sessions: SessionTable) {
        super({name: "expired-sessions", lock: "exclusive", intervalMs: 10 * 60_000, timeoutMs: 60_000})
        this.sessions = sessions
    }

    async getDataSet(limit: number): Promise<Session[]> {
        return this.sessions.listExpired(Date.now(), limit)
    }

    async processRow(session: Session, signal: AbortSignal): Promise<void> {
        await this.sessions.delete(session.id)
    }
}
```

`name` is the lock id: keep it stable across deployments. `signal` aborts when the job lost its lock or the runtime is stopping; pass it on to long calls.

## Wiring in Runtime

```typescript
import {GGJobRunner} from "@grest-ts/job"
import {GGDynamoDbLock} from "@grest-ts/lock-dynamodb"

class MyRuntime extends GGRuntime {
    protected compose(): void {
        const db = MyConfig.db.newDynamoDb()

        new GGJobRunner({lock: new GGDynamoDbLock(db, {tableName: "my-service.locks"})})
            .add(new ExpiredSessionsJob(new SessionTable(db)))
    }
}
```

The runner starts with the runtime. On teardown it stops new rows, waits for running ones and frees its locks. With a single instance, `new GGInstanceLock()` from `@grest-ts/lock` is enough.

## Lock Modes

| `lock` | Who runs it | Use when |
|---|---|---|
| `exclusive` | One instance at a time, at most once per `intervalMs` across all of them. | The default. The run must not overlap itself. |
| `item` | Every instance; each row is locked by `rowKey(row)` before `processRow`. | Many rows, and instances should share them. |
| `none` | Every instance. `processRow` guards its own rows. | The data store claims rows itself (e.g. a conditional status flip). |

An `exclusive` run that finishes keeps its lock until the next run is due (`release({until})`), and every instance checks every `checkEveryMs` whether it can take it. With `item`, `getDataSet` must drain itself (a processed row drops out of it), and `processRow` must re-check its row: another instance may have finished it after it was read.

## Configuration

| Field | Default | |
|---|---|---|
| `name`, `lock`, `intervalMs` | | See above |
| `timeoutMs` | | Lock TTL, renewed while the run (or row) is alive. A run still going past it is logged. |
| `limit` | `500` | Rows per batch, passed to `getDataSet` |
| `parallel` | `1` | Rows processed concurrently |
| `maxExtraRuns` | `0` | Further batches in the same run while a batch comes back full |
| `startupDelayMs` | 1–2 s, jittered | Delay before the first run |
| `checkEveryMs` | `intervalMs / 10`, 60 s–15 min | How often an `exclusive` job checks whether it is due |
| `settings` | | Live overrides, see below |

Optional hooks: `rowKey(row)` (required for `item`), `dataSetFinished(report)` after each batch, `describeRow(row)` for logs.

### Live Settings

A `GGSetting` with the `IsGGJobSettings` schema overrides `intervalMs`, `limit`, `parallel` and `maxExtraRuns`, and `enabled: false` pauses the job. It is read at the start of every run, so changes need no deploy:

```typescript
export const MyConfig = GGConfig.define("/my-service/", () => ({
    expiredSessionsJob: new GGSetting("jobs/expired-sessions", IsGGJobSettings, {}, "Expired sessions job overrides"),
}))

super({name: "expired-sessions", lock: "exclusive", intervalMs: 10 * 60_000, timeoutMs: 60_000, settings: MyConfig.expiredSessionsJob})
```

## Failures

- A row that throws is logged and counted; the rest of the batch still runs, and no extra batch follows.
- A data set that fails to load fails the run. An `exclusive` run that failed or was stopped holds no lock afterwards, so the next check runs it again.
- When the lock is lost, the run's signal fires and rows not yet started are skipped (see `withLock` in [`@grest-ts/lock`](@pkg/lock)). An `item` row whose lock was lost counts as failed; one whose lock another instance holds is skipped (`report.skipped`).

## Metrics

Recorded when the runtime has a `GGMetricsLoader`, labelled by `job`: `/job/runs_total`, `/job/run_duration_ms`, `/job/rows_total` (`result`: `OK` / `ERROR`), `/job/rows_in_flight`, `/job/lock_lost_total`.

## Testing

`runJobOnce` runs one batch of a job's own logic, with no runner and no locks. Row errors are returned, not thrown:

```typescript
import {runJobOnce} from "@grest-ts/job/testkit"

const {rows, errors} = await runJobOnce(new ExpiredSessionsJob(table))
```
