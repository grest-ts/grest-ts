# Wire Logging + Schema-Driven Redaction

Per-package, async-context-bound logging policy for HTTP and WebSocket
clients in grest-ts. Logs flow through `GGLog` (the shared sink). Payloads
and headers are redacted via the existing `clean()` AOT, extended with a
`{showSecrets: boolean}` option that respects a `sensitive` flag on
`GGSchemaDefinition`.

Default mode is `ALL` — visibility-first. Callers opt down to `NON_OK`
(only sketchy outcomes) or `OFF` (silenced; required for high-perf paths
where node logging is the bottleneck and nginx already covers requests).

## Scope

In:
- `@grest-ts/http` client wire-log
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
- Server-side HTTP/WS logging
- Per-org / multi-tenant log separation

## Architecture

### Per-package config (strict isolation)

Each transport package owns its own enum and config class. No shared type.

```ts
// @grest-ts/http
export enum GGHttpLogMode { ALL = 0, NON_OK = 1, OFF = 2 }

export class GGHttpLogConfig {
    public mode: GGHttpLogMode = GGHttpLogMode.ALL
    static readonly KEY = new GGLocatorKey<GGHttpLogConfig>("GGHttpLogConfig")
    static get(): GGHttpLogConfig { /* tryGet ?? DEFAULT */ }
    static set(mode: GGHttpLogMode): void { /* into current scope */ }
}

// @grest-ts/websocket — duplicate, not shared
export enum GGWsLogMode { ALL = 0, NON_OK = 1, OFF = 2 }
export class GGWsLogConfig { /* same shape, distinct KEY */ }
```

Integer-backed enum for cheap comparison. `OFF` is the fast-path check
before any entry construction (no allocations, no string building).

### Logging output

All wire-log output goes through `GGLog`. The wire-log path only decides
*whether* to call `GGLog.info/warn/error` and *what* to put in `data`.
GGLog stays the only logging primitive in the framework.

Outcome → level mapping:
- HTTP success (2xx) → `INFO`
- HTTP 4xx (excl. validation) → `WARN`
- HTTP 5xx, network error, timeout → `ERROR`
- HTTP validation error → `WARN`
- WS outgoing call success → `INFO`
- WS outgoing call rejected / timed out → `WARN`/`ERROR`
- WS incoming validation error → `WARN`
- WS unexpected drop → `WARN`; retries exhausted → `ERROR`

NON_OK = anything not at INFO level.

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
- A node marked both `sensitive` and `pii` is redacted if either flag is
  hidden (the strictest redaction wins).
- Branch is highly predictable; perf hit on existing callers is negligible
  (and zero on schemas with no marked nodes).

The same option pattern is added to `stringify` for parity (callers that
need a string-formatted redacted value). `parse` is left untouched for
now — its `coerce` arg stays positional; opts-bag migration there is a
separate decision.

Output is a structurally-equivalent object (preserves dev-console
collapsibility, composes inside a larger wire-log envelope).

`sensitive` and `pii` are top-level fields on `GGSchemaDefinition` (not
nested under `docs`), so the AOT walker treats them as structural
properties. `.sensitive()` and `.pii()` are chain methods that set them
via `derive()` (presentational). They compose: `.sensitive().pii()`
sets both.

**Two flags, not one classification**:
- A field can be both (auth tokens, SSN, bank account)
- Independent flags compose naturally
- Future categories (e.g. `internal`) can be added without API breakage

**Default policies**:
- Wire-log: `showSecrets: false, showPii: true` — secrets always redacted,
  PII visible (the email being logged is often the point).
- PII redaction is opt-in by callers at boundaries where PII shouldn't
  flow (analytics events, third-party error trackers, audit exports).

**Built-in marking**:
- `sensitive: true`: `IsPassword`, `IsBearerToken`
- `pii: true`: `IsEmail`, `IsPhone`, `IsIp`, `IsLatitude`, `IsLongitude`
- Notable *not* auto-marked PII: `IsDate`/`IsTimestamp` (DOB is PII but
  most dates aren't), `IsString` (names are PII but most strings aren't),
  `IsCountry`/`IsLanguage`/`IsLocale` (too coarse). Mark with `.pii()`
  explicitly when context warrants.

Authorization headers flow through middleware-declared header schemas
using `IsBearerToken`-family types, so header redaction is automatic —
wire-log calls `headerSchema.clean(value, {showSecrets: false})` per
header.

**Breaking change**: existing `clean(value, transform: boolean)` callers
need to migrate to `clean(value, {transform: true})`. Codebase audit +
mechanical update during phase 3.

---

## Phases

### Phase 1 — `@grest-ts/http` wire-log

**New**
- `packages/http/http/src/client/GGHttpLogConfig.ts`
  - `enum GGHttpLogMode { ALL, NON_OK, OFF }`
  - `class GGHttpLogConfig` with static get/set, `KEY = new GGLocatorKey(...)`

**Modify**
- `packages/http/http/src/client/GGHttpSchema.createClient.ts`
  - Inside `implementation` (line 89): wrap with `OFF` fast-path,
    classify outcome, build entry, dispatch to `GGLog.{info|warn|error}`
  - Capture: `method`, `url`, `status`, `durationMs`, `input`, `output`,
    `headers`, `validationIssues?`, `error?`
  - Phase 1 logs raw `input`/`output`/`headers` (unsafe). Marked with
    `// TODO redact` at the call sites; replaced in phase 4.

**Tests**
- `packages/http/http/src/client/GGHttpLogConfig.spec.ts` — get/set,
  async-context isolation across two parallel scopes
- Integration test in http package — ALL logs success, NON_OK skips
  success but logs errors, OFF logs nothing

### Phase 2 — `@grest-ts/websocket` wire-log

**New**
- `packages/http/websocket/src/client/GGWsLogConfig.ts` — same shape,
  distinct `enum GGWsLogMode`, distinct `KEY`

**Modify**
- `packages/http/websocket/src/client/GGWebSocketSchema.createClient.ts`
  - Outgoing wrap inside `outgoingImpl[methodName]` (line 294):
    log around `socket.send`. NON_OK → only on rejection.
  - Incoming wrap inside `buildSetupTools().incoming.on` (line 311):
    log inside the `wrapped` handler with the validated payload.
    NON_OK → only on validation error.
  - Connection lifecycle in `openOnce`, `scheduleReconnect`,
    `fireFinalClose`: `INFO` for handshake/open/close on ALL,
    `WARN`/`ERROR` for unexpected drops + reconnect failures
    on both ALL and NON_OK.

**Tests**
- `packages/http/websocket/src/client/GGWsLogConfig.spec.ts`
- Integration test against the testkit client (modes, lifecycle)

### Phase 3 — Schema-side `sensitive`/`pii` + `clean`/`stringify` redaction option

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
    (`(opts && (opts.showSecrets === false || opts.showPii === false))`)
  - Else → existing emit unchanged
- For container nodes whose own def has `sensitive` or `pii` set →
  emit `"[REDACTED]"` and skip descent entirely (when corresponding
  flag is hidden)
- Optional/nullable wrappers → preserve undefined/null, descend on
  present value
- Schemas with no marked nodes anywhere in the subtree → identical
  output to today (zero perf change)

**Modify `executor/standard/impl/` equivalents** (interpreter parity)

**Mark built-ins**
- `sensitive: true`:
  - `custom/IsPassword.ts`
  - `custom/IsBearerToken.ts`
- `pii: true`:
  - `custom/IsEmail.ts`
  - `custom/IsPhone.ts`
  - `custom/IsIp.ts`
  - `custom/IsLatitude.ts`
  - `custom/IsLongitude.ts`

**Surface flags in OpenAPI/AsyncAPI generation**
- `GGSchemaDescription` already passes through metadata; extend
  consumer code to emit `x-sensitive: true` and `x-pii: true` when set
- Inspect `packages-libs/docs/` (or wherever OpenAPI is generated) to
  find the right insertion point

**Migrate existing `clean(v, true)` callers**
- Audit grest-ts internal callers of `clean(value, transformBoolean)`
- Mechanical rewrite to `clean(value, {transform: true})`
- Same for downstream consumers if any sit in this repo

**Tests** (schema package self-tests itself reasonably well first)
- `GGSchema.clean.spec.ts` — extend existing tests with redaction matrix
  (or new `GGSchema.clean.redaction.spec.ts` if cleaner):
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
- Mirror smaller suite in `GGSchema.stringify.spec.ts` for stringify path
- Append redaction test to `IsPassword.spec.ts`, `IsBearerToken.spec.ts`,
  `IsEmail.spec.ts`, `IsPhone.spec.ts`, `IsIp.spec.ts`,
  `IsLatitude.spec.ts`, `IsLongitude.spec.ts`

**Contract-time guard (testkit helper)**
- Add `assertNoSensitiveInResponses(api)` to the appropriate testkit
  package (likely `packages-tooling/testkit/testkit/`)
- Walks every contract response schema (`success` + error variants),
  fails if any reachable leaf has `sensitive: true`
- Reuses the schema-walking machinery from the AOT executor
- Unit test demonstrating: passes for clean API, fails when a
  sensitive field is in a response schema
- Note: no auto-PII variant — sometimes returning PII is intentional

### Phase 4 — Wire redaction into wire-log

**Modify HTTP integration**
- Replace raw `input` / `output` with
  `contractFn.input.clean(data, {showSecrets: false})` and
  `schema?.clean(resData.data, {showSecrets: false})`
- Headers: iterate `httpSchema.apiMiddlewares`, build a per-call
  header schema map; for each header with a declared schema, redact
  via `headerSchema.clean(value, {showSecrets: false})`; undeclared
  headers logged key-name only

**Modify WS integration**
- Outgoing: `contractFn.input.clean(data, {showSecrets: false})`
- Incoming: `serverToClientContract.methods[methodName].clean(validated, {showSecrets: false})`

**Integration test (dedicated)**
- `examples/grest-test/test/wireLogRedaction.test.ts` — secret logging
  is important enough to deserve its own test (not an addition to
  `logs.test.ts`)
- TDD-ordered: write the test first using `it.fails(...)` while phase 3
  is in progress; remove `.fails` once redaction lands and integration
  is wired. End state: green and stays green.
- Extend `examples/grest-test/src/api/` with a small endpoint that
  takes a payload containing an `IsPassword` field plus an
  `IsBearerToken` header (existing patterns in `MainConfig.api.ts`
  show the shape; mirror those)
- Capture `GGLog` output via a custom `GGLogger`, assert the secret
  *value* never appears (`expect(JSON.stringify(captured)).not.toContain(...)`)
- Cover both HTTP and WS variants in the same file

### Phase 5 — Hub-client migration

**Modify `packages/hub-client/src/api/SocketClient.ts`**
- Remove all `socketLog.*` calls
- At app startup, set `GGWsLogConfig.set(...)` based on `window.location.hostname`
  (mirrors current localhost-only default)

**Delete `packages/hub-client/src/api/socketLog.ts`**
- After a few days of dogfooding the new path

---

## Sequencing

1. Phase 1 (HTTP config + integration, raw payload)
2. Phase 2 (WS config + integration, raw payload)
3. Phase 3 (schema `sensitive` + `clean`/`stringify` opts migration + schema tests)
4. Phase 4 (redaction wired into HTTP+WS, integration test goes green)
5. Phase 5 (hub-client migration)

Phases 1 and 2 are independent and can land in either order.
Phase 4's integration test can be authored as `it.fails(...)`
during phase 3 development to make the redaction goal explicit.

## Decisions baked in

- Per-package isolated configs and enums — no shared types
- Integer-backed enums for cheap comparison
- `OFF` mode = no entry construction (perf-critical fast path)
- Default mode = `ALL`
- All output flows through `GGLog`; wire-log is policy only
- `sensitive` and `pii` are top-level `GGSchemaDefinition` fields
- `.sensitive()` and `.pii()` chain methods as sugar; compose freely
- Two independent flags rather than a single classification field —
  composes naturally and stays extensible (future `internal()` etc.)
- Wire-log default: redacts secrets, leaves PII visible. PII redaction
  is opt-in by callers at downstream boundaries (analytics, error
  trackers, audit exports)
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
- WeakMap-tagged data → GGLog auto-redaction: explicitly out of scope
  for now (spread loses tag, implicit magic; revisit if direct-GGLog
  leakage becomes operationally painful)
- Log-side string truncation (`maxStringLength` for huge fields) noted
  as future work, separate from redaction infrastructure
