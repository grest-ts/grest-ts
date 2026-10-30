# Known scalability / multi-instance issues

Framework behaviours that are fine in dev and single-instance tests but break apps at scale or with more than one instance. Each one was found while auditing a downstream app (kratt) and verified against the source. Line numbers are as of 2026-10-21 (grest-ts 0.0.84) and will drift — search for the named symbol if they don't match.

Until an issue is fixed, the `scalability-review` skill (`.claude-plugin/grest-ts/skills/scalability-review/references/grest-ts.md`) warns about it in app code. When you fix one, update that file too.

Roughly in priority order.

---

## 1. `GGLock`: no fencing token, and leases follow the instance clock

**Where:** `packages-libs/lock/lock/src/GGLock.ts`, `packages-libs/lock/lock/src/withLock.ts`, `packages-libs/lock/lock-dynamodb/src/GGDynamoDbLock.ts`

**Breaks:** the owner stops a holder whose lease expired from renewing or releasing its successor's lock, but nothing stops it from *writing*. A holder paused past its TTL (GC, a blocked event loop) keeps working next to the new holder until it next renews; `withLock` aborts the work's signal then, up to `ttl / 3` later. Lease expiry compares instance clocks, so clock skew shortens or stretches leases.

**Fix:**
- Return a monotonically increasing fencing token per acquire, so callers can use it as a write condition.
- Use store-side time where the store offers it.

## 2. Kubernetes discovery clobbers the shared ConfigMap and has no cache

**Where:** `packages/discovery/discovery-kubernetes/src/GGKubernetesServiceDiscovery.ts:112-148` (register), `:181-216` (unregister), `:230` (`discoverApi`)

**Breaks:**
- Register PUTs the whole ConfigMap containing only this service's entries, without `resourceVersion`, so every registration wipes the other services' entries.
- When any one replica shuts down, `unregister` deletes the API's entry, so scale-down and rolling deploys make the API undiscoverable while other replicas still run.
- `discoverApi` fetches the ConfigMap on every call with no cache and no timeout, and URL-less clients resolve on every request. That hits API-server rate limits and adds latency, and the client timeout doesn't cover it.

**Fix:**
- Use read-modify-write with `resourceVersion` (retry on 409), or a JSON patch of only this service's keys.
- Unregister only when this pod is the last replica, or drop unregistering and rely on DNS.
- Cache with a TTL and apply a timeout.
- Consider making `discoverApiViaDns` the default.

## 3. Shutdown tears down business services before HTTP stops taking requests

**Where:** `packages/runtime/src/GGRuntime.ts:43-44` (hard-coded `shutdownTimeoutMs: 10000`), `:100-103`, `:195`, `:205-218`; `packages/locator/src/GGLocatorScope.ts` (`GGLocatorServiceType` order); `packages/http/http/src/server/GGHttpServer.ts:117,265` (3 s drain)

**Breaks:**
- Teardown runs from the highest service type down: discovery → periodic jobs → **business** → intl → **HTTP** → DB. Until HTTP's turn, the server keeps routing requests to business services that are already torn down.
- The 3 s drain and 10 s total are hard-coded (`GGRuntimeConfig.shutdownTimeoutMs` can't be set).
- If the timeout fires, `withTimeout` rejects inside the SIGTERM handler, an unhandled rejection, and the process exits with 1 instead of 0.
- There is no `unhandledRejection` handler, so one stray rejection in app code kills the instance. That's Node's default, but combined with #5 the framework itself can trigger it.

**Fix:**
- At the start of shutdown, stop accepting traffic: HTTP returns 503 and the readiness probe fails. Then tear down services. Optionally wait a short "deregistration delay" first.
- Make the drain and shutdown timeouts configurable.
- Catch the timeout and exit with an explicit code.
- Document a `preStop` sleep for k8s and the LB deregistration delay.

## 4. Events: silent local fallback, dropped publishes, crash on timer flush

**Where:**
- `packages/runtime/src/GGRuntime.ts:116-122` (local discovery when none is registered)
- `packages-libs/events/events/src/pub/EventPublisherClient.ts:115-117,186,207,228,236-239`
- `packages-libs/events/events/src/sub/EventSubscriberClient.ts:124-128,180,199-200`
- `packages-libs/events/events-aws/src/AwsSqsAdapter.ts:102-104`

**Breaks:**
- **Silent local fallback.** If production discovery isn't registered, the runtime silently uses local discovery, and events go through an in-memory, in-process broker. Nothing errors.
- **Unconfigured adapter.** Publishing returns OK and drops the event.
- **Batching.** `publish` resolves once the event is buffered, and the batch is cleared before it's sent. A failed send rethrows: from the timer flush (`setTimeout(() => this.flushBatch())`) that's an unhandled rejection, which crashes the process.
- **SQS subscriber:**
  - Messages are processed in sequential chunks with a 30 s visibility timeout that is never extended, so slow batches get redelivered to other instances.
  - Messages that fail validation are never deleted, so they loop forever.

**Fix:**
- Fail start-up in production mode when no discovery or adapter is configured, or at least log an error.
- Make an unconfigured publish an error.
- Catch timer flushes, and re-queue or log failed batches instead of dropping them.
- Extend visibility while processing.
- Delete or dead-letter messages that fail validation.
- Document idempotent handlers and a DLQ.
- Longer term, add an outbox helper for "DB write + publish".

## 5. WebSocket: no backpressure, no `maxPayload`, no reconnect jitter, no cross-instance fan-out

**Where:** `packages/http/websocket/src/adapter/NodeSocketAdapter.ts:22-23` (`ws.send` with no `bufferedAmount` check), `server/GGSocketServer.ts:193` (no `maxPayload`, so the `ws` default of 100 MiB applies), `:177` (process-local `activeSockets`), `:223-227` (closes every socket at once), `src/client/reconnectConnector.ts:304-307` (500 ms ×2, 30 s cap, no jitter)

**Breaks:** slow or hostile clients grow server memory without bound. Every deploy causes a synchronized reconnect storm. There's no way to push to a user connected to another instance.

**Fix:**
- Add a `bufferedAmount` high-water mark per socket that drops or closes past the limit.
- Set a sensible default `maxPayload`, configurable per schema.
- Add full jitter to reconnects, and stagger closes on teardown.
- Document or provide a cross-instance broadcast pattern via `@grest-ts/events`.

## 6. Postgres: swallowed connect failure, no pool `error` listener

**Where:** `packages-libs/db/db-postgre/src/GGPostgres.ts:37,59`; no `.on("error")` anywhere in db-postgre

**Breaks:**
- A failed connect at start-up is swallowed: the instance reports started and passes readiness, then every query throws.
- When an idle client errors (DB restart, failover), `pg` emits on the pool, and with no listener that crashes the process.
- Neither Postgres nor MySQL has a connection-acquire timeout (MySQL `packages-libs/db/db-mysql/src/GGMysql.ts:46-47` also has unbounded waiters up to `queueLimit`).

**Fix:**
- Throw on a failed connect, as MySQL already does.
- Add `pool.on("error", log)`.
- Expose `connectionTimeoutMillis` / acquire timeout and statement timeout settings.
- Document pool sizing as `db_max / instances`.

## 7. HTTP client timeout doesn't cover the body or discovery

**Where:** `packages/http/http/src/client/GGHttpSchema.createClient.ts:101` (15 s default), `:137-162` (discovery before the timer), `:170-171` (timer cleared before the body is parsed)

**Breaks:** a slow response body or a slow discovery lookup hangs the call indefinitely.

**Fix:** start the timer before discovery and clear it after the body is parsed. Optionally accept an `AbortSignal` or deadline from the caller and pass it on.

## 8. DynamoDB: missing primitives push apps toward unsafe patterns

**Where:** `packages-libs/db/db-dynamodb/src/GGDynamoDb.ts` `getRawClient` (builds a new client per call); `GGDynamoDbTable.ts` `queryOne` (doesn't check uniqueness)

**Breaks:** with no batch or transaction helpers and no optimistic-version helper, apps write N+1 loops, check-then-put uniqueness and unconditional read-modify-write. Dropping to `getRawClient()` costs a new `DynamoDBClient` per call, and you lose marshalling.

**Fix:**
- Add `batchGet` and `batchWrite` that retry the unprocessed keys and items.
- Add `transactWrite`.
- Add a `putVersioned` / `updateVersioned` helper that manages a version attribute.
- Add a `putUnique` helper using guard items.
- Cache the raw client.

## 9. AWS Secrets Manager config never refreshes

**Where:** `packages/config/config-aws/src/GGConfigStoreAwsSecretsManager.ts:27-50`

**Breaks:** rotating a secret requires restarting every instance, and during a rolling restart instances run with different credentials.

**Fix:** optional periodic refresh that fires the existing watch callbacks (as the file store does), plus documentation on dual-validity rotation.

## 10. Testkit hides multi-instance bugs

**Where:** `packages-libs/db/db-dynamodb/testkit/GGDynamoDbSchemaCloner.ts:48-49` (dynamodb-local), `packages-tooling/testkit/testkit/src/GGTest.ts:42` (`GG_COVERAGE_MODE=1` silently turns `startWorker` into inline)

**Breaks:**
- dynamodb-local doesn't reproduce eventual consistency, so GSI and read-after-write races pass locally.
- Coverage runs silently drop process isolation.
- There's no documented way to test "two instances of the same runtime".

**Fix:**
- Document `GGTest.startWorker([A, A])` and `GGTest.startIsolated` for multi-instance tests.
- Warn when coverage mode downgrades isolation.
- Consider a test helper that runs the same claim or conditional write concurrently and asserts exactly one winner.
