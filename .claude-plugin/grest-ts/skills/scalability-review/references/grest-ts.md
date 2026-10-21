# grest-ts failure modes

Framework behaviours that work in dev and tests but break at scale or with more than one instance. Each entry: what to flag in app code → the framework-provided fix, or what the app has to do itself.

## @grest-ts/db-dynamodb
- **`query()` / `scan()` / `GGDynamoDbTable.scan()` with no `limit` load every page and throw once a result passes 10,000 rows** (`MAX_AUTO_PAGED_ITEMS`). Any of these on a partition that grows with users or time is a future 500, not just a slow call. → `queryPage(index, keyCond, values, {limit, descending, cursor})` / `scanPage({limit, cursor})`, which return `{items, cursor?}`. Loop on `cursor`, not on `items.length`: a page can be empty and still have a cursor. Return the cursor to the client as an opaque string, and map `GGDynamoDbCursorError` to a 400.
- **`get()`, `queryPage` and `scanPage` never set `ConsistentRead`.** Read-after-write across instances can return stale data. Lock, claim or "read then conditional write" paths need `getRawClient()` with `ConsistentRead: true`, or should rely on the conditional write itself.
- **`queryOne` is `query(..., {limit: 1})[0]`.** It doesn't check uniqueness, and on a GSI it is eventually consistent. "Check username free, then put" races. → a guard item written with `putConditional(item, "attribute_not_exists(pk)")`.
- **`put()` and `delete()` are unconditional.** A get-modify-`put` loses concurrent updates. → `putConditional(item, cond, values, attrNames)` (returns `false` on conflict) with an app-managed version field (`version` is a reserved word, so pass `attributeNames`). Or `updateFields(current, fields)`, which writes only those fields and only while the row exists. A version field must also be bumped by every partial update, or a stale full `put` will pass.
- **No batch or transaction helpers.** N single calls in a loop is the default trap. → `getRawClient()` with `BatchGet`/`BatchWrite`/`TransactWrite` (marshalling is the app's job; retry `UnprocessedKeys`/`UnprocessedItems`).

## @grest-ts/db-mysql, @grest-ts/db-postgre
- **The pool defaults to 20 connections per instance.** N instances × 20 can exhaust `max_connections`. MySQL rejects waiters beyond `queueLimit` (2 × pool) with "Queue limit reached"; Postgres has no acquire timeout, so callers wait forever. → size `connectionLimit` in the `GGResource` config as `db_max / instances`.
- **Postgres start-up swallows a failed connect.** The instance reports as started, then every query throws. Flag missing readiness checks that run a real query.
- **The select builder allows `exec()` with no limit, and `execOne` doesn't add `LIMIT 1`.** → `.limit(n)` / `.limit1()`. `.limit([offset, n])` is offset paging and degrades on deep pages; prefer keyset (`where id > :last`) for large tables. Use `.forUpdate()` inside `runInTransaction` for read-modify-write.

## @grest-ts/lock, @grest-ts/poller
- **`GGInstanceLock` (the only shipped `GGLock`) is a process-local `Map`.** With N replicas every instance "holds" the lock. Flag any `GGInstanceLock` guarding cross-instance work in a service that can scale out. → implement `GGLock` on a shared store, e.g. DynamoDB `putConditional` with `attribute_not_exists(pk) OR expiresAt < :now`.
- **The `GGLock` API has no owner or fencing token** (`acquire/renew/release(lockId)`, and release deletes unconditionally). A holder whose TTL expired can renew or release someone else's lock. A custom implementation must store an owner ID per instance and check it on renew and release.
- **`GGPoller` has one leader only if its lock is distributed.** With `GGInstanceLock`, N replicas means N leaders processing the same rows.
- **`GGPoller` re-polls while the previous batch is still running, and keeps processing after losing leadership.** `getData` can return items already in flight. → `getData` must atomically *claim* rows (conditional status flip). "Optionally mark as processing" in the docs is effectively required. `run` must be idempotent.
- **`GGPoller` swallows `getData`, `run` and lock errors (metrics only, no log), and its settings have no defaults.** Flag handlers without their own logging and `GGPollerConfig` resources missing any timing field. The package is marked under development.

## @grest-ts/events (+ events-aws/azure/gcp)
- **With no production `GG_DISCOVERY` registered (e.g. `NODE_ENV` not `production`), the runtime starts local discovery, and events silently use an in-memory, in-process broker.** Nothing errors; events just never leave the process. → register production discovery explicitly in `compose()`.
- **Publishing on an unconfigured adapter returns OK and drops the event. With `batching`, `publish` resolves once the event is buffered in memory, a failed flush is only logged, and a crash loses the buffer.** → non-batched publish (it retries and surfaces `SERVER_ERROR`) for anything that must not be lost. There is no outbox: flag "write DB row, then publish" where both must happen, and make the publish recoverable.
- **SQS subscriber: visibility timeout 30 s by default, messages processed in sequential chunks of `concurrency ?? 1`, visibility never extended.** A slow batch gets redelivered to another instance and processed twice. Messages that fail validation are never deleted, so they loop forever. → tune `concurrency`/`batchSize`/`visibilityTimeout`, use idempotent handlers, and configure a DLQ in infra.

## @grest-ts/discovery-kubernetes
- **`discoverApi` fetches the ConfigMap from the k8s API on every call, with no cache, and URL-less `createClient()` resolves on every request.** That means API-server rate limits and extra latency per call.
- **Registration PUTs the whole ConfigMap without `resourceVersion`, and one replica's shutdown deletes the API's entry.** Services overwrite each other, and rolling deploys or scale-down make APIs undiscoverable. → don't use it with more than one replica; use `discoverApiViaDns(...)`, `GGStaticServiceDiscovery`, or `createClient({url})`.

## @grest-ts/websocket
- **No backpressure (`ws.send` never checks `bufferedAmount`), and `maxPayload` isn't set (the `ws` default is 100 MiB).** Slow or hostile clients grow server memory. App code that pushes streams should check `bufferedAmount` and drop or close.
- **Socket tracking is per process, and there's no broadcast API.** "Push to user X" only works if X is connected to this instance. → fan out across instances through `@grest-ts/events` or another shared bus.
- **Client reconnect is exponential (500 ms ×2, 30 s cap) with no jitter, and the server closes every socket at once on teardown.** Every deploy causes a synchronized reconnect storm. Flag apps that replay all subscriptions or init calls on reconnect without spreading them out.

## @grest-ts/http client and runtime
- **The default client timeout (15 s) is cleared before the response body is parsed.** A slow body hangs the call. There are no retries, so a peer's deploy surfaces 503s. → `createClient({timeout})`; app-level retry only for idempotent calls.
- **A `GGPromise` turns failures into error values and only throws when awaited.** An un-awaited call won't crash, but its failure disappears. Flag fire-and-forget calls whose failure matters, and use `.asResult()`/`.orDefault()` where failure is expected. A plain `void somePromise` (not `GGPromise`) without `.catch` still crashes the process.
- **`GGRuntime` registers no `unhandledRejection` handler,** so Node's default applies and one stray rejection kills the instance. → the app adds `process.on("unhandledRejection", log)`.
- **On SIGTERM the HTTP server immediately returns 503 to new requests and waits a fixed 3 s for in-flight ones, inside a 10 s overall shutdown.** Requests the load balancer still routes during endpoint removal get 503s, and longer requests are cut. → `shutdownTimeoutMs`, a k8s `preStop` sleep / LB deregistration delay, and no long work inside requests.

## @grest-ts/config, config-aws
- **`GGConfigStoreAwsSecretsManager` fetches once at start and never refreshes.** Rotating a secret needs a restart, and during a rolling restart instances run with different credentials. → keep old and new credentials both valid during rotation. `key.watch()` only works for file stores.
- **Reading config with `.get()` at module scope or caching it in a constructor pins the value** (this is also a convention rule). Hot-reloaded config then reaches only some code paths.

## @grest-ts/testkit: why tests pass anyway
- DynamoDB tests run on dynamodb-local, which doesn't reproduce eventual consistency, so GSI and read-after-write races pass locally. `GGTestPollerStore` is in-memory. `GGTest.startInline([A, A])` shares process-wide statics such as the local event broker.
- → For multi-instance behaviour, use `GGTest.startWorker([MyRuntime, MyRuntime])` (separate workers), and test conditional-write conflicts and idempotency explicitly, e.g. call the same claim twice and assert that exactly one wins.

## Already handled (don't flag)
- Unbounded DynamoDB reads fail loudly at 10k instead of exhausting memory; `queryPage` cursors are opaque and validated.
- `putConditional` maps `ConditionalCheckFailedException` to `false`; `updateFields` is existence-conditioned; writes are schema-validated.
- HTTP request bodies are capped at 1 MiB by default (`maxBodyBytes` per contract → `PAYLOAD_TOO_LARGE`).
- The HTTP client has a default timeout and returns typed errors instead of throwing transport exceptions.
- WebSocket heartbeats on both ends close dead peers; handshakes time out; client reconnect has a capped exponential backoff.
- Teardown order (discovery → periodic jobs → services → HTTP → DB) is sensible, and `runInTransaction` handles commit, rollback and release.
