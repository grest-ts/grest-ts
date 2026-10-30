<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/job

Recurring batch work over a data set you own: cleanups, reconciliation, backfills, expiry sweeps, an outbox relay. A job runs every `intervalMs`, loads the rows that need work (`getDataSet`) and processes each one (`processRow`). By default one instance at a time runs it, coordinated through a [`GGLock`](@pkg/lock).

**This is not a queue.** There is no `enqueue`: a job finds its work by querying state, so a row that is missed or fails is picked up on the next run. For heavy item-level work, let a job feed a message queue instead: see [Job patterns](./README-patterns.md).

## Defining a Job

A job's schedule and tuning live in a `GGSetting` with the `IsGGJobSettings` schema. Its default is the job's configuration; a stored value replaces it at runtime, without a deploy.

```typescript
import {GGConfig, GGSetting} from "@grest-ts/config"
import {GGJob, IsGGJobSettings} from "@grest-ts/job"

export const MyConfig = GGConfig.define("/my-service/", () => ({
    jobs: {
        expiredSessions: new GGSetting("jobs/expired-sessions", IsGGJobSettings, {
            intervalMs: 10 * 60_000,
            timeoutMs: 60_000,
        }, "Expired sessions job"),
    },
}))

export class ExpiredSessionsJob extends GGJob<Session> {

    private readonly sessions: SessionTable

    constructor(sessions: SessionTable) {
        super({name: "expired-sessions", settings: MyConfig.jobs.expiredSessions})
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

**Every step must be safe to run twice.** A lock is a lease: an instance that stalls past `timeoutMs` can overlap the next holder until it notices, and a stopped run is picked up again. Write results conditionally or idempotently, as above, where deleting an already-deleted session is harmless.

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

`runner.run(name)` runs a job now and leaves the schedule as it was. A `oneInstance` job answers `BUSY` until its last scheduled run's cooldown ends: the lock is what keeps it to one run per interval.

## Where It Runs

| `runOn` | |
|---|---|
| `oneInstance` (default) | One instance at a time, at most once per `intervalMs` across all of them. A finished run keeps its lock until the next one is due; every instance checks every `checkEveryMs` whether it can take it. |
| `everyInstance` | Every instance, for work each one must do itself, such as warming a local cache. |

## Settings

| Field | Default | |
|---|---|---|
| `intervalMs` | required | Time between runs |
| `timeoutMs` | required | Lock TTL, renewed while a run is alive; a run still going past it is logged |
| `enabled` | `true` | `false` skips every run until it is set back |
| `limit` | `500` | Rows per batch, passed to `getDataSet` |
| `parallel` | `1` | Rows processed concurrently |
| `maxExtraRuns` | `0` | Further batches in the same run while a batch comes back full |
| `checkEveryMs` | `intervalMs / 10`, 60 s–15 min | How often a `oneInstance` job checks whether it is due |
| `startupDelayMs` | 1–2 s, jittered | Delay before the first run |

The runner reads the setting at the start of every run. A stored value replaces the whole default, as for any `GGSetting`, so store the full object: `{"intervalMs": 600000, "timeoutMs": 60000, "enabled": false}`. A lowered `intervalMs` on a `oneInstance` job applies once the current hold runs out.

Optional hooks: `dataSetFinished(report)` after each batch, `describeRow(row)` for logs.

## Failures

- A row that throws is logged and counted; the rest of the batch still runs, and no extra batch follows.
- A data set that fails to load fails the run. A `oneInstance` run that failed or was stopped holds no lock afterwards, so the next check runs it again.
- When the lock is lost, the run's signal fires and rows not yet started are skipped (see `withLock` in [`@grest-ts/lock`](@pkg/lock)).

## Metrics

Recorded when the runtime has a `GGMetricsLoader`, labelled by `job`: `/job/runs_total`, `/job/run_duration_ms`, `/job/rows_total` (`result`: `OK` / `ERROR`), `/job/rows_in_flight`, `/job/lock_lost_total`.

## Testing

In a `GGTest` runtime, jobs don't run on their own: timed runs would race the test. Run one when the test needs it. The run goes through the runner as usual (settings, lock, batches) and sees the test's mocks:

```typescript
const t = GGTest.startWorker(MyRuntime)

await t.jobs.run("expired-sessions")
    .with(mockOf(SessionTable).listExpired.andReturn([session]))
    .toEqual({result: "DONE", rows: 1, failed: 0, batches: 1})
```

- `result` is `DONE`, `BUSY` (another instance holds the lock), `LOST` or `DISABLED`. A run that fails fails the action.
- With several instances, pick one: `t[1].jobs.run(...)`.
- `await t.jobs.start()` starts the schedules, for a test about scheduling itself.
- Change a job's setting with `t.config.update(MyConfig.jobs.expiredSessions, {...})`.

`runJobOnce` runs one batch of a job's own logic in a unit test, with no runtime, runner or lock. Row errors are returned, not thrown:

```typescript
import {runJobOnce} from "@grest-ts/job/testkit"

const {rows, errors} = await runJobOnce(new ExpiredSessionsJob(table))
```
