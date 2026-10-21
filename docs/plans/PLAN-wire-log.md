# WebSocket Wire Logging + Schema-Driven Redaction

Per-client logging policy for the `@grest-ts/websocket` client. Logs
flow through `GGLog` (the shared sink). Payloads and headers are
redacted via the existing `clean()` AOT, extended with `{showSecrets,
showPii}` options that respect `sensitive` / `pii` flags on
`GGSchemaDefinition`.

Mode is a static construction-time option on `Api.createClient({logMode})`
— wire-log noise level is a deployment decision, not a per-request one.
No async-context plumbing.

WebSocket-only scope. HTTP wire-log was considered and dropped: HTTP
calls are already visible (browser DevTools Network tab, server-side
access logs, the receiving grest HTTP server logs request lifecycle).
WS frames are invisible-by-default in both browser (DevTools doesn't
auto-decode frames) and server (no built-in framing logger). Wire-log
adds visibility precisely where it doesn't already exist.

Default mode is `ALL` — visibility-first. Callers opt down to `NON_OK`
(only sketchy outcomes) or `OFF` (silenced; high-perf paths or paths
with their own observability).

## Scope

In:
- `@grest-ts/websocket` client wire-log (per-frame + connection lifecycle)
- `@grest-ts/schema` `sensitive` and `pii` flags, `.sensitive()` and
  `.pii()` chain methods, `{showSecrets, showPii}` options threaded into
  existing AOT operations (`clean`, `stringify`)
- Pre-marking built-in branded types:
  - `sensitive`: `IsPassword`, `IsBearerToken`
  - `pii`: `IsEmail`, `IsPhone`, `IsIp`, `IsLatitude`, `IsLongitude`
- Surface flags in OpenAPI/AsyncAPI generation (`x-sensitive`, `x-pii`)
- Contract-time guard: `assertNoSensitiveInResponses(api)` testkit helper
- Hub-client migration off `socketLog.ts`

Out (separate work later):
- HTTP client wire-log (visible elsewhere; not worth the integration cost)
- Server-side WS logging (servers already log handshakes and lifecycle)
- Per-org / multi-tenant log separation
- WeakMap-tagged data → GGLog auto-redaction (spread loses tag; implicit)
- Log-side string truncation (`maxStringLength`) — separate concern

## Architecture

### Config = a construction-time option

```ts
// @grest-ts/websocket
export enum GGWsLogMode { OFF = 0, NON_OK = 1, ALL = 2 }

// Usage at the consumer:
const client = MyWsApi.createClient({
    url: "...",
    logMode: GGWsLogMode.NON_OK,  // optional, defaults to ALL
})
```

Mode is captured once at `createClient`, stored as a closure constant,
and read by every emission site as a local variable. No locator
interaction, no async-context propagation. To change mode you create a
new client.

Integer-backed enum for cheap comparison. `OFF` is the fast-path check
before any entry construction (no allocations, no string building).

### Logging output

All wire-log output goes through `GGLog`. The wire-log path only decides
*whether* to call `GGLog.info/warn/error` and *what* to put in `data`.

Outcome → level mapping:
- WS handshake / connect / clean close → `INFO` (ALL only)
- WS outgoing call success → `INFO` (ALL only)
- WS outgoing call rejected / timed out → `WARN` / `ERROR`
- WS incoming message dispatched → `INFO` (ALL only)
- WS incoming validation error → `WARN`
- WS unexpected drop → `WARN`
- WS reconnect attempt / success → `INFO` (ALL only)
- WS retries exhausted / unrecoverable → `ERROR`

`NON_OK` = anything not at `INFO` level.

### Redaction (extended `clean` AOT)

No new top-level method, no new AOT function. The existing `clean()` AOT
gains `showSecrets` and `showPii` options. When `false`, matching nodes
are emitted as the literal string `"[REDACTED]"` instead of the value.

```ts
public clean(value: unknown, opts?: {
    transform?: boolean,
    showSecrets?: boolean,  // default true
    showPii?: boolean,      // default true
}): unknown
```

- One AOT-compiled function per schema, takes the options at runtime.
- At each marked node, codegen emits a single ternary, e.g.:
  `out["password"] = (opts && opts.showSecrets === false) ? "[REDACTED]" : value["password"]`
- A node marked both `sensitive` and `pii` is redacted if either flag
  is hidden (the strictest redaction wins).
- Branch is highly predictable; perf hit on existing callers is negligible
  (and zero on schemas with no marked nodes).

The same option pattern is added to `stringify` for parity (callers that
need a string-formatted redacted value). `parse` is left untouched —
its `coerce` arg stays positional; opts-bag migration there is a
separate decision.

Output is a structurally-equivalent object (preserves dev-console
collapsibility, composes inside a larger wire-log envelope).

`sensitive` and `pii` are top-level fields on `GGSchemaDefinition` (not
nested under `docs`), so the AOT walker treats them as structural
properties. `.sensitive()` and `.pii()` are chain methods that set them
via `derive()` (presentational). They compose: `.sensitive().pii()`
sets both.

**Two flags, not one classification**: a field can be both (auth tokens,
SSN, bank account); independent flags compose; future categories (e.g.
`internal()`) can be added without API breakage.

**Default policies**: wire-log sets `showSecrets: false, showPii: true`
— secrets always redacted, PII visible (the email being logged is often
the point). PII redaction is opt-in by callers at downstream boundaries
(analytics, error trackers, audit exports).

**Built-in marking**:
- `sensitive: true`: `IsPassword`, `IsBearerToken`
- `pii: true`: `IsEmail`, `IsPhone`, `IsIp`, `IsLatitude`, `IsLongitude`
- *Not* auto-marked PII: `IsDate`/`IsTimestamp` (DOB is PII but most
  dates aren't), `IsString` (names are PII but most strings aren't),
  `IsCountry`/`IsLanguage`/`IsLocale` (too coarse). Mark with `.pii()`
  explicitly when context warrants.

WS handshake headers flow through middleware-declared header schemas
(`GGWebSocketMiddleware.headers`). Auth headers using `IsBearerToken`
get redacted automatically — wire-log calls
`headerSchema.clean(value, {showSecrets: false})` per header.

**Breaking change**: existing `clean(value, transform: boolean)` callers
need to migrate to `clean(value, {transform: true})`. Codebase audit +
mechanical update during phase 2.

---

## Phases

### Phase 1 — `@grest-ts/websocket` wire-log

**New**
- `packages/http/websocket/src/client/GGWsLogMode.ts` — exports just
  the enum:
  ```ts
  export enum GGWsLogMode { OFF = 0, NON_OK = 1, ALL = 2 }
  ```

**Modify**
- `packages/http/websocket/src/client/GGWebSocketSchema.createClient.ts`
  - Add `logMode?: GGWsLogMode` to `GGWebSocketClientConfig`
  - Capture `const logMode = config?.logMode ?? GGWsLogMode.ALL` once
    at the top of the client factory
  - Outgoing wrap inside `outgoingImpl[methodName]`: log around
    `socket.send`. NON_OK → only on rejection.
  - Incoming wrap inside `buildSetupTools().incoming.on`: log inside
    the `wrapped` handler with the validated payload. NON_OK → only on
    validation error.
  - Connection lifecycle in `openOnce`, `scheduleReconnect`,
    `fireFinalClose`: INFO on ALL for handshake/open/clean-close;
    WARN/ERROR for unexpected drops + reconnect failures on both
    ALL and NON_OK.
  - Add `emitWsLog()` helper at file bottom for centralized
    formatting + dispatch.
- Phase 1 logs raw payload (unsafe). Marked with `// TODO redact` at
  call sites; replaced in phase 3.

**Export**
- `index-browser.ts` and `index-node.ts`: re-export from
  `client/GGWsLogConfig`

**Tests**
- Integration test in `examples/grest-test/test/wsWireLog.test.ts`,
  mirroring the pattern in `websocket-client.test.ts`:
  - ALL: outgoing call logs at INFO with method/durationMs
  - NON_OK: outgoing success skipped; rejection logged at WARN/ERROR
  - OFF: no entries
  - Lifecycle: connect/disconnect logged at INFO under ALL
  - Capture via custom `GGLogger` registered against the test scope

### Phase 2 — Schema-side `sensitive`/`pii` + `clean`/`stringify` opts

**Modify `Definition.ts`**
- Add `readonly sensitive?: boolean` to `GGSchemaDefinition`
- Add `readonly pii?: boolean` to `GGSchemaDefinition`

**Modify `GGSchema.ts`**
- Add `.sensitive(): this` chain method — `derive({sensitive: true}, true)`
- Add `.pii(): this` chain method — `derive({pii: true}, true)`
  (both presentational; preserve `_base`)
- Migrate `clean()` signature:
  - From: `clean(value: unknown, transform: boolean = false): unknown`
  - To:   `clean(value: unknown, opts?: {transform?: boolean, showSecrets?: boolean, showPii?: boolean}): unknown`
- Migrate `stringify()` signature similarly: add
  `opts?: {showSecrets?: boolean, showPii?: boolean}`
  (also `unsafeStringify`, `stringifyMultipart`, `unsafeStringifyMultipart`)
- One cached AOT fn per operation per schema; redaction options are
  runtime args

**Modify `executor/ExecutorStrategy.ts`**
- `CleanFn` signature: `(value, opts?: {transform?, showSecrets?, showPii?}) => unknown`
- `StringifyFn` signature: add `opts?: {showSecrets?, showPii?}`

**Modify `executor/aot/impl/AOT_Clean.ts` and `AOT_Stringify.ts`**
- For each schema kind, at each property/element emission:
  - If `childDef.sensitive === true` → emit
    `out["k"] = (opts && opts.showSecrets === false) ? "[REDACTED]" : value["k"]`
  - Else if `childDef.pii === true` → emit
    `out["k"] = (opts && opts.showPii === false) ? "[REDACTED]" : value["k"]`
  - If both flags set → either flag's "hide" wins
  - Else → existing emit unchanged
- Container nodes whose own def has `sensitive` or `pii` set →
  emit `"[REDACTED]"` and skip descent entirely (when corresponding
  flag is hidden)
- Optional/nullable wrappers → preserve undefined/null, descend on
  present value
- Schemas with no marked nodes anywhere in the subtree → identical
  output to today (zero perf change)

**Modify `executor/standard/impl/` equivalents** (interpreter parity)

**Mark built-ins**
- `sensitive: true`: `custom/IsPassword.ts`, `custom/IsBearerToken.ts`
- `pii: true`: `custom/IsEmail.ts`, `custom/IsPhone.ts`,
  `custom/IsIp.ts`, `custom/IsLatitude.ts`, `custom/IsLongitude.ts`

**Surface flags in OpenAPI/AsyncAPI generation**
- Extend consumers in `packages-libs/docs/` to emit `x-sensitive: true`
  and `x-pii: true` when set

**Migrate existing `clean(v, true)` callers**
- Audit grest-ts internal callers
- Mechanical rewrite to `clean(value, {transform: true})`

**Tests** (schema package self-tests reasonably well first)
- `GGSchema.clean.spec.ts` (or new `GGSchema.clean.redaction.spec.ts`):
  - Primitives non-marked (passthrough)
  - Primitives marked `sensitive` (redacted with `showSecrets: false`)
  - Primitives marked `pii` (redacted with `showPii: false`)
  - Field marked both — hidden if either flag is `false`
  - Object with marked leaf (sensitive / pii / both)
  - Nested object, marked at depth
  - Array of marked
  - Array of objects, one field marked
  - Record (dynamic keys), value schema marked
  - Tuple with one marked position
  - Union — one variant marked, the other not
  - Discriminated union — variant-specific marking
  - Optional/nullable wrapping a marked schema
  - `.sensitive()` / `.pii()` on a container redacts the entire subtree
  - `transform: true, showSecrets: false` — both effects compose
  - `showSecrets: false, showPii: false` — both hides simultaneously
- Mirror smaller suite in `GGSchema.stringify.spec.ts`
- Append redaction test to `IsPassword.spec.ts`, `IsBearerToken.spec.ts`,
  `IsEmail.spec.ts`, `IsPhone.spec.ts`, `IsIp.spec.ts`,
  `IsLatitude.spec.ts`, `IsLongitude.spec.ts`

**Contract-time guard (testkit helper)**
- Add `assertNoSensitiveInResponses(api)` to `packages-tooling/testkit/testkit/`
- Walks every contract response schema (`success` + error variants),
  fails if any reachable leaf has `sensitive: true`
- Reuses the schema-walking machinery from the AOT executor
- Unit test: passes for clean API, fails when a sensitive field is
  in a response schema
- No auto-PII variant — sometimes returning PII is intentional

### Phase 3 — Wire redaction into WS wire-log

**Modify `GGWebSocketSchema.createClient.ts`**
- Outgoing: `contractFn.input.clean(data, {showSecrets: false})`
- Incoming: `serverToClientContract.methods[methodName].clean(validated, {showSecrets: false})`
- Handshake headers: build per-call header schema map from
  middleware `headers`, redact each declared header value via
  `headerSchema.clean(value, {showSecrets: false})`; undeclared
  headers logged key-name only

**Integration test (dedicated)**
- `examples/grest-test/test/wsWireLogRedaction.test.ts` — secret
  logging is important enough to deserve its own test
- TDD-ordered: write the test first using `it.fails(...)` while phase
  2 is in progress; remove `.fails` once redaction lands. End state:
  green and stays green.
- Extend `examples/grest-test/src/api/` with a small WS endpoint
  carrying an `IsPassword` field plus an `IsBearerToken` handshake
  header (mirror existing `AuthedSocketApi` patterns)
- Capture `GGLog` output via custom `GGLogger`, assert the secret
  *value* never appears

### Phase 4 — Hub-client migration

**Modify `packages/hub-client/src/api/SocketClient.ts`**
- Remove all `socketLog.*` calls
- When constructing the WS client, pass `logMode` based on
  `window.location.hostname` (e.g. `ALL` for localhost, `NON_OK` in prod)

**Delete `packages/hub-client/src/api/socketLog.ts`**
- After a few days of dogfooding the new path

---

## Sequencing

1. Phase 1 (WS wire-log, raw payload)
2. Phase 2 (schema `sensitive`/`pii` + opts migration + schema tests)
3. Phase 3 (redaction wired into WS, integration test goes green)
4. Phase 4 (hub-client migration)

Phase 3's integration test can be authored as `it.fails(...)` during
phase 2 development to make the redaction goal explicit.

## Decisions baked in

- WS-only scope (HTTP wire-log dropped — already visible elsewhere)
- Mode is a construction-time option on `Api.createClient({logMode})`,
  static for the client lifetime — no async-context plumbing, no
  locator interaction, no framework changes
- Integer-backed enum with `OFF = 0` so the fast-path gate is a single
  truthy check (`if (logMode) emit(...)`) — terser than `!== OFF`
- `OFF` mode = no entry construction (perf-critical fast path)
- Default mode = `ALL`
- All output flows through `GGLog`; wire-log is policy only
- `sensitive` and `pii` are top-level `GGSchemaDefinition` fields
- `.sensitive()` and `.pii()` chain methods as sugar; compose freely
- Two independent flags rather than a single classification field —
  composes naturally and stays extensible (future `internal()` etc.)
- Wire-log default: redacts secrets, leaves PII visible. PII redaction
  is opt-in by callers at downstream boundaries
- No new `logify` method/AOT — extend existing `clean` (and `stringify`)
  with `{showSecrets?, showPii?}` options; one AOT fn per operation,
  runtime branch at marked nodes
- Options-bag style: `clean(value, {transform?, showSecrets?, showPii?})`
  — also migrates the existing positional `transform` (breaking change)
- Output is object (preserves dev-console collapsibility, composes)
- Redaction string: literal `"[REDACTED]"` (no length/type leakage)
- Headers participate in redaction via existing middleware schemas
- Tests in `grest-test/` keep wire-log enabled by default; only suppress
  if it becomes operationally noisy/slow
- Surface flags in OpenAPI/AsyncAPI as `x-sensitive` / `x-pii`
- Contract-time guard `assertNoSensitiveInResponses(api)` testkit
  helper enforces "no sensitive field in any response schema"
