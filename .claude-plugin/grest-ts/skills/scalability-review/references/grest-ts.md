# grest-ts failure modes

Framework behaviours that work in dev and tests but break at scale or with more than one instance. Each entry: what to flag in app code → the framework-provided fix, or what the app has to do itself. Framework-side fixes are tracked in the grest-ts repo's `SCALABILITY_ISSUES.md`. When an entry there is fixed, update this file.

## @grest-ts/db-dynamodb
- **`query()` / `scan()` with no `limit` load every page and throw once a result passes 10,000 rows** (`MAX_AUTO_PAGED_ITEMS`). `GGDynamoDbTable.scan()` takes no limit at all. Any of these on a partition that grows with users or time is a future 500. → `queryPage(index, keyCond, values, {limit, descending, cursor})` / `scanPage({limit, cursor})`, which return `{items, cursor?}`. Loop on `cursor`, not on `items.length`: a page can be empty and still have a cursor. Return the cursor to the client as an opaque string, and map `GGDynamoDbCursorError` to a 400.
- **`get()`, `queryPage` and `scanPage` never set `ConsistentRead`.** That's only a problem when correctness depends on the read itself. If the write that follows is `putConditional`, a stale read just fails the condition. Otherwise use the raw client (`getRawClient()` on `GGDynamoDb`, reached via the protected `db` in a table subclass; it builds a new client per call, so hoist it).
- **`queryOne` is `query(..., {limit: 1})[0]`.** It doesn't check uniqueness, and on a GSI it's eventually consistent. "Check username free, then put" races. → a guard item written with `putConditional(item, "attribute_not_exists(pk)")`.
- **`put()` and `delete()` are unconditional.** get → modify → `put` loses concurrent updates. → `putConditional(item, cond, values, attrNames)` (returns `false` on conflict) with an app-managed version field (`version` is a reserved word, so pass `attributeNames`). `updateFields(current, fields)` writes only the given fields and only while the row exists, but it's still last-writer-wins per field; contended fields need the version check.
- **No batch or transaction helpers.** N single calls in a loop is the default trap. → the raw client's `BatchGet`/`BatchWrite`/`TransactWrite` (marshalling is the app's job; retry `UnprocessedKeys`/`UnprocessedItems`).

## @grest-ts/db-mysql, @grest-ts/db-postgre
- **Pools default to 20 connections per instance, with no acquire timeout on either.** N instances × 20 can exhaust `max_connections`. MySQL rejects waiters beyond `queueLimit` (2 × pool) with "Queue limit reached", and the waiters inside that limit wait without bound, as do Postgres callers. → size `connectionLimit` in the `GGResource` config as `db_max / instances`.
- **Postgres: a failed connect at start-up is swallowed, and the pool has no `'error'` listener.** The instance reports started and then every query throws; an idle client error (DB restart, failover) crashes the process. Flag deployments without readiness checks that run a real query.
- **The select builder allows `exec()` with no limit, and `execOne` doesn't add `LIMIT 1`.** → `.limit(n)` / `.limit1()`. `.limit([offset, n])` is offset paging; prefer keyset (`where id > :last`) for large tables. Use `.forUpdate()` inside `runInTransaction` for read-modify-write.

## @grest-ts/lock, @grest-ts/poller
- **The shipped `GGLock`s, `GGInstanceLock` and `GGLocatorScopeLock`, are process-local.** With N replicas every instance "holds" the lock. → implement `GGLock` on a shared store, e.g. DynamoDB `putConditional` with `attribute_not_exists(pk) OR expiresAt < :now`, using store-side time.
- **The `GGLock` API has no owner or fencing token** (`acquire/renew/release(lockId)`, and release deletes unconditionally). A holder whose lease expired can renew or release someone else's lock. A custom implementation must track the owner, and work done under the lock should be fenced (see `multi-instance.md`).
- **`GGPoller` has one leader only if its lock is distributed.** With a process-local lock, N replicas means N leaders processing the same rows.
- **`GGPoller` re-polls while the previous batch is still running, and `run` calls already in flight continue after leadership is lost.** `getData` can return items that are already being processed. → `getData` must atomically *claim* rows (a conditional status flip; "optionally mark as processing" in the docs is effectively required), and `run` must be idempotent. `stop()` only waits for the latest batch.
- **`GGPoller` failures are mostly invisible.** `getData` and lock errors get no log and no metric; `run` errors get a metric only; a throwing `onCompleted` is an unhandled rejection (crash). Settings have no defaults: a missing `pollIntervalMs` busy-loops, and a missing `batchSize` or `concurrency` gives `NaN`. Flag handlers without their own logging and `GGPollerConfig` resources missing any field. The package is marked under development.

## @grest-ts/events (+ events-aws/azure/gcp)
- **With no production `GG_DISCOVERY` registered, the runtime starts local discovery, and events silently use an in-memory, in-process broker.** Nothing errors; events just never leave the process. → register production discovery explicitly in `compose()`.
- **Publishing on an unconfigured adapter returns OK and drops the event.**
- **With `batching`, `publish` resolves once the event is buffered in memory.** A failed flush drops the batch; when the flush was triggered by the timer, the rethrown error is an unhandled rejection that crashes the process. A crash also loses the buffer. → non-batched publish (it retries and surfaces `SERVER_ERROR`) for anything that must not be lost.
- **There is no outbox.** Flag "write the DB row, then publish" where both must happen.
- **SQS subscriber: visibility timeout 30 s by default, messages processed in sequential chunks of `concurrency ?? 1`, visibility never extended.** A slow batch is redelivered to another instance and processed twice. Messages that fail validation are never deleted, so they loop forever. → tune `concurrency`/`batchSize`/`visibilityTimeout`, dedupe in handlers by message id, and set up a DLQ in infra.

## @grest-ts/discovery-kubernetes
- **`discoverApi` fetches the ConfigMap from the k8s API on every call, with no cache and no timeout, and URL-less `createClient()` resolves on every request.** That means API-server rate limits, extra latency, and a hang that the client timeout doesn't cover (discovery runs before the timer starts).
- **Registration PUTs the whole ConfigMap with only this service's entries and no `resourceVersion`, and one replica's shutdown deletes the API's entry.** Every registration wipes the other services, and scale-down makes the API undiscoverable. → don't use it with more than one replica, or with more than one service: `createClient({url: GGKubernetesServiceDiscovery.discoverApiViaDns("svc", {port})})`, or `GGStaticServiceDiscovery`. Neither registers itself; register discovery explicitly.

## @grest-ts/websocket
- **No backpressure (`ws.send` never checks `bufferedAmount`), and `maxPayload` isn't set (the `ws` default is 100 MiB).** Slow or hostile clients grow server memory. App code that pushes streams should check `bufferedAmount` and drop or close.
- **Socket tracking is per process, and there's no broadcast API.** "Push to user X" only works if X is connected to this instance. → fan out across instances through `@grest-ts/events` or another shared bus.
- **Client reconnect is exponential (500 ms ×2, 30 s cap) with no jitter, and the server closes every socket at once on teardown.** Every deploy causes a synchronized reconnect storm. Flag apps that replay every subscription or init on reconnect without spreading them out.

## @grest-ts/http client and runtime
- **The default client timeout (15 s) is cleared before the response body is parsed, and doesn't cover discovery.** A slow body or discovery call hangs. There are no retries, so a peer's deploy surfaces as 503s. → `createClient({timeout})`; app-level retry only for idempotent calls.
- **The HTTP client's `GGPromise` turns failures into error values, so an un-awaited call doesn't crash, but its failure disappears.** Use `.asResult()`/`.orDefault()` where failure is expected. This doesn't hold for every `GGPromise`: an un-awaited events `publish` can still reject and crash.
- **`GGRuntime` registers no `unhandledRejection` handler,** so Node's default applies: one stray rejection kills the instance. If the app adds one, it must log *and exit*.
- **Shutdown order is wrong for traffic.** On SIGTERM, teardown runs discovery → periodic jobs → business → HTTP → DB. HTTP starts returning 503 only when its own turn comes, so requests in between reach business services that are already torn down. The HTTP drain (3 s) and overall shutdown (10 s) are hard-coded. If the timeout fires, the process exits with code 1. → a `preStop` sleep / LB deregistration delay so traffic stops before SIGTERM, and no long work inside requests.

## @grest-ts/config, config-aws
- **`GGConfigStoreAwsSecretsManager` fetches once at start and never refreshes.** Rotating a secret needs a restart, and during a rolling restart instances run with different credentials. → keep old and new credentials both valid during rotation. `key.watch()` only works for file stores.
- **`.get()` at module scope, or cached in a constructor, pins the value** (also a convention rule), so hot-reloaded config reaches only some code paths.

## @grest-ts/testkit: why tests pass anyway
- DynamoDB tests run on dynamodb-local, which doesn't reproduce eventual consistency, so GSI and read-after-write races pass. `GGTestPollerStore` is in-memory. With `GG_COVERAGE_MODE=1`, `startWorker` silently runs inline.
- → For multi-instance behaviour, use `GGTest.startWorker([MyRuntime, MyRuntime])` (separate workers) or `GGTest.startIsolated` (separate processes). Test conditional-write conflicts and idempotency explicitly, e.g. run the same claim twice and assert exactly one wins.

## Already handled (don't flag)
- Unbounded DynamoDB reads fail loudly at 10k instead of exhausting memory; `queryPage` cursors are opaque and validated.
- `putConditional` maps `ConditionalCheckFailedException` to `false`; `updateFields` is existence-conditioned; writes are schema-validated.
- HTTP request bodies are capped at 1 MiB by default (`maxBodyBytes` per contract → `PAYLOAD_TOO_LARGE`).
- The HTTP client has a default timeout and returns typed errors instead of throwing transport exceptions.
- WebSocket heartbeats on both ends close dead peers; handshakes time out; client reconnect has a capped exponential backoff.
- `runInTransaction` handles commit, rollback and release.
