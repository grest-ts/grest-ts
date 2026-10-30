<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/job

Recurring, scheduled batch work over a data set you own: cleanups, reconciliation, backfills, expiry sweeps, an outbox relay. A job runs every `intervalMs`, loads the rows that need work (`getDataSet`) and processes each one (`processRow`). It is safe to run on several instances of the same service.

**This is not a queue.** There is no `enqueue`: the job finds its work by querying state, so a row that is missed or fails is picked up again on the next run. For per-event units of work pushed from elsewhere, use a message queue (e.g. `@grest-ts/events`). [Job processing patterns](./README-patterns.md) maps the patterns and when to move from one to the other.

- **`GGJob<Row>`**: the job. Subclass it and implement `getDataSet` + `processRow`.
- **`GGJobRunner`**: runs jobs for the lifetime of the runtime. It starts with the runtime and, on teardown, stops new rows, waits for running ones and frees its locks.
- **`GGJobLock`**: what instances coordinate through. `GGJobInstanceLock` is in-memory (one process); [`@grest-ts/job-dynamodb`](@pkg/job-dynamodb) shares it across instances.

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

    async processRow(session: Session): Promise<void> {
        await this.sessions.delete(session.id)
    }
}
```

`name` is the lock id, so keep it stable across deployments.

## Wiring in Runtime

```typescript
import {GGJobRunner} from "@grest-ts/job"
import {GGJobDynamoDbLock} from "@grest-ts/job-dynamodb"

class MyRuntime extends GGRuntime {
    protected compose(): void {
        const db = MyConfig.db.newDynamoDb()

        new GGJobRunner({lock: new GGJobDynamoDbLock(db, {tableName: "job-locks"})})
            .add(new ExpiredSessionsJob(new SessionTable(db)))
    }
}
```

Use `new GGJobInstanceLock()` instead when only one instance runs, or in local development.

## Lock Modes

| `lock` | Who runs it | Use when |
|---|---|---|
| `exclusive` | One instance at a time runs the whole job, at most once per `intervalMs` across all instances. | The default. The run must not overlap itself. |
| `item` | Every instance runs the job; each row is locked by `rowKey(row)` before `processRow`. | Many rows, and you want instances to share them. |
| `none` | Every instance runs the job. `processRow` guards its own rows. | Rows are claimed by the data store itself (e.g. a conditional status flip). |

With `item`, `getDataSet` must drain itself (a processed row must drop out of it), and `processRow` must re-check its row: it was read before another instance may have finished it.

An `exclusive` job asks whether it is due every `checkEveryMs` (default `intervalMs / 10`, within 60 s–15 min), so when the instance that ran it stops, another one runs it when it is next due.

## Configuration

| Field | Default | Description |
|---|---|---|
| `name` | | Lock id; stable across deployments |
| `lock` | | `exclusive`, `item` or `none` |
| `intervalMs` | | Time between runs |
| `timeoutMs` | | Lock TTL, renewed every `timeoutMs / 3` while the run (or row) is alive. A run still going past it is logged. |
| `limit` | `500` | Rows per batch, passed to `getDataSet` |
| `parallel` | `1` | Rows processed concurrently |
| `maxExtraRuns` | `0` | Further batches in the same run while a batch comes back full |
| `startupDelayMs` | 1–2 s, jittered | Delay before the first run |
| `checkEveryMs` | `intervalMs / 10`, 60 s–15 min | How often an `exclusive` job checks whether it is due |
| `settings` | | Live overrides, see below |

Optional hooks on `GGJob`: `rowKey(row)` (required for `item`), `dataSetFinished(report)` after each batch, `describeRow(row)` for logs.

### Live Settings

Pass a `GGSetting` with the `IsGGJobSettings` schema to change a job without a deploy. It is read at the start of every run, and its fields override the configured ones:

```typescript
import {IsGGJobSettings} from "@grest-ts/job"

export const MyConfig = GGConfig.define("/my-service/", () => ({
    expiredSessionsJob: new GGSetting("jobs/expired-sessions", IsGGJobSettings, {}, "Expired sessions job overrides"),
}))

super({name: "expired-sessions", lock: "exclusive", intervalMs: 10 * 60_000, timeoutMs: 60_000, settings: MyConfig.expiredSessionsJob})
```

| Field | Effect |
|---|---|
| `enabled` | `false` skips every run until it is set back |
| `intervalMs`, `limit`, `parallel`, `maxExtraRuns` | Replace the configured value |

## Failures and Shutdown

- A row that throws is logged and counted. The rest of the batch still runs, and no extra batch follows.
- A data set that fails to load is logged; the next run tries again.
- When the lock is lost (another owner took it after the TTL), the run's `AbortSignal` fires and rows not yet started are skipped. A lost lock is never released.
- On teardown the runner aborts the signal and waits for running rows. An interrupted `exclusive` run records no last run, so another instance picks it up straight away.

`processRow(row, signal)` gets that signal; pass it on to long calls.

## Metrics

Recorded when the runtime has a `GGMetricsLoader`, labelled by `job`:

| Metric | Type |
|---|---|
| `/job/runs_total` | counter |
| `/job/run_duration_ms` | counter |
| `/job/rows_total` (`result`: `OK` / `ERROR`) | counter |
| `/job/rows_in_flight` | gauge |
| `/job/lock_lost_total` | counter |

## Testing

`runJobOnce` runs one batch of a job's own logic, with no runner and no locks. Row errors are returned, not thrown:

```typescript
import {runJobOnce} from "@grest-ts/job/testkit"

const {rows, errors} = await runJobOnce(new ExpiredSessionsJob(table))
```

## Writing a Lock

A `GGJobLock` is a `GGLock` (see [`@grest-ts/lock`](@pkg/lock)) with two extras for `exclusive` jobs:

- `acquire(id, owner, ttlMs, lastRunAtMost?)` succeeds only when no live lock holds `id` and, with `lastRunAtMost`, when the recorded last run started at or before it.
- `release(id, owner, ranAt?)` records `ranAt` as the last run; without it, the lock is dropped entirely.

Both must be atomic, and `renew` / `release` must do nothing unless `owner` holds the lock.
