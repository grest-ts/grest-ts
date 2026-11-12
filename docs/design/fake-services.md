# Fakes for third-party services: a framework feature or an app concern?

Status: **design brief, for discussion**. Driver: kratt's test-quality work (`kratt/docs-history/TEST_QUALITY.md`),
where fakes (above all fakegit) replaced most hand-built mocks at the GitHub boundary.

**Recommendation: no new framework abstraction.** Add a "Fakes for third-party services" section to the testkit
README that describes the pattern (fakegit is the worked example), plus the contract-check pattern. Section 4
explains why.

## Two kinds of test double

- **Mock** (`@mockable` + `mockOf(X).m.andReturn(…)`, `Api.mock.m`): replaces one return value per action. It
  holds no state, and our client code for the third party never runs.
- **Fake**: a stand-in for the third party itself. It holds state and speaks the real protocol, so our
  integration code runs for real: request building, auth headers, pagination, parsing and retries.

## 1. What kratt's fakes have in common

The five fakes come in **three shapes**, and only one of them is a grest-ts runtime:

| Fake | Shape | Size | State | Seed / admin | Reset | Faults | Wiring | Contract check |
|---|---|---|---|---|---|---|---|---|
| **fakegit** (`tools/fakegit`) | `GGRuntime`; GitHub REST as `GGHttpSchema`s over a custom server-only codec (`GitHubRest`); git smart-HTTP, OAuth, raw files, webhooks | ~4.9k LOC + UI | `JsonStateStore` (frozen snapshot, copy-on-write, flushed to a file because it's also a dev service) | `FakeGitAdminApi`, a normal contract with 35 methods that the UI uses too | `admin.reset({world})` in a `GGTestContext` hook | `state.faults` (`server_error`/`rate_limit`/`sso_required`, N calls, latency) used by the token wire handler | `worker.config.update(github_url, url)`, App identity on both sides (`wireFakeGitApp`), port from `admin.info()` | Its own tests (10 files), checked against its own reading of GitHub |
| **fakeOAuthServer** (mcp) | `node:http` in the test process | 77 | Closure object | Public fields (`revoked`, `tokenRequests`) | New server | `revoked` set, `opts` flags | URL passed as an argument | None |
| **FakeProvider** (hub-cron) | `implements Provider`, in-process | ~200 | Maps | `seedServer`/`seedImage` | New instance | `throwOnX` fields, `vanishBefore` (a world event) | Constructor / registry stub | Written to answer like Hetzner (error *strings* the retry classifier reads); not checked |
| **FakeKrattHost** (ai) | `implements AiCliHost`; interprets tmux/find/cat/stat argv | 418 | Maps | Public sets (`unreadable`, `dialogs`, `ignoreHup`) | New instance | World-shaped (`ignoreHup`, unreadable paths) | `GGLocatorKey` in a test runtime | None |
| **FakeUserSystemd** (services) | `extends SystemdAdapter`; unit commands decide behaviour (`trap "" TERM`) | ~230 | Maps | `crash()`, `restartAfterBackoff()` | New instance | World-shaped (`crash`, start-limit) | Constructor | None |

What each one does by hand:

- **State store**: always a few Maps or one object. Only fakegit needs more (persistence, atomic mutate), and
  that's because it doubles as a long-running dev tool with a UI.
- **Admin / seed API**: in-process fakes use public methods. fakegit uses a contract, and **30 of its 35
  methods are domain verbs** (`installApp`, `authorizeOAuth`, `mergePull`, `completeRun`, …). The generic five
  are `info`, `getState`, `reset`, `reload` and `setFaults`.
- **Reset**: one line in every case (`admin.reset` in `beforeEach`, or `new Fake()`).
- **Faults**: the ones that found bugs are **domain-shaped**:
  - `sso_required` needs the authenticated principal.
  - FakeProvider must throw Hetzner's exact error text for `isRetryableProviderError`.
  - systemd's `TimeoutStopSec` comes from a `trap`.

  The generic part (500/429/latency for the next N calls) is about 15 lines.
- **Wiring**: a `GGSetting` that `config.update` points at the fake, or a constructor argument. kratt only
  hand-rolls the fake's URL (`admin.info().port`), and `GG_DISCOVERY.discoverApi("FakeGitAdminApi")` already
  covers that.
- **Contract checking**: **none of the five is checked against the real service.** That is the real gap.
  TEST_QUALITY's Round 3 lesson ("a fake at an event boundary must emit the real *sequence*… review the fake
  against the real implementation") was learned by hand.

## 2. What a framework helper could provide

A `GGFakeService` sketch, to show the most a base class could take over:

```ts
// Hypothetical. Not proposed.
export class FakeGitRuntime extends GGFakeService<FakeGitState, World> {
    static readonly NAME = "fakegit"
    protected initialState(world?: World) { return stateFromWorld(world ?? DEFAULT_WORLD) }   // → admin.reset/getState
    protected faults = GGFakeFaults.http({rateLimitError: RATE_LIMITED})                     // → admin.setFaults + middleware
    protected composeFake(state: GGFakeState<FakeGitState>) {
        new GGHttp(this.httpServer).http(GitHubReposApi, new GitHubReposApiImpl(state, …))   // unchanged, all of it
        …
    }
}
// test
const fake = GGTest.startFake(FakeGitRuntime, {world: {...}, resetEach: true})
await fake.faults.next(2, "server_error")
await t.hub.config.update(HubConfig.settings.githubUrl, fake.url)
```

```ts
// fakeOAuthServer under the same base: it becomes a runtime + contract + codec for RFC 8414/7591/6749
// form bodies. That's more code than its 77 lines, for two unit tests that already pass the URL in.
```

What each piece would save:

| Piece | Generic? | Saves in fakegit | Note |
|---|---|---|---|
| Typed state + `getState`/`reset(world)` | Yes | ~60 LOC (`JsonStateStore` stays: persistence is a dev-tool need) | Every app's `World` shape differs, so the admin contract would have to be generic over a schema. That's doable, but `reset` is already one method. |
| Auto admin contract | Partly | 4–5 of 35 methods | The other 30 are domain verbs, and the UI uses them. |
| Per-test reset | Yes | 1 line | `GGTestContext.beforeEach` already does this. |
| Fault scheduling (next N → error, latency) | Yes | ~15 LOC | Kratt's rule 7 says failures should come from **the fake's world** (a server that vanishes, a revoked token), not from switches on the fake. A generic switchboard pushes the other way. The faults that mattered (`sso_required`, Hetzner's error text) stay hand-written. |
| Discovery wiring (`fake.url`) | Yes | `admin.info()` (7 call sites) | Already possible with `GG_DISCOVERY.discoverApi(...)`. A one-line testkit getter for a runtime's base URL is the only small thing worth considering (open question 3). |
| Speaking the vendor's wire | No | — | `GGHttpCodec` is already the extension point, and fakegit's `GitHubRest` codec proves it works. |
| Vendor semantics (App JWTs, token narrowing, git, webhooks, CI) | No | — | This is 95 % of fakegit. |

**Three of the five fakes would not touch the helper at all.** FakeProvider, FakeKrattHost and FakeUserSystemd
are in-process implementations of a TypeScript port. The framework's part there is already done: the port is a
typed interface, and they `implements` it, so they break when it changes.

## 3. Contract-checking fakes against the real thing

This is where fakes drift and where kratt has nothing today. Pattern: **one scenario set, two targets.**

```ts
// githubContract.scenarios.ts: shared by both runs
export interface GitHubTarget {
    client: GitHubAppClient            // production client code, pointed at the target
    seed: {repo(name: string): Promise<RepoRef>, revokeToken(t: string): Promise<void>}
}
export function githubContract(target: () => GitHubTarget) {
    test("installation token narrowed to one repo can't read another", async () => { … })
    test("rate limit answers 403/429 with the documented headers", async () => { … })
    test("list endpoints paginate with Link rel=next", async () => { … })
}

// fakegit: every PR
describe("GitHub contract: fakegit", () => { GGTest.startWorker(FakeGitTestRuntime); githubContract(() => fakeTarget) })
// real: nightly / on demand, skipped without credentials
describe.runIf(process.env.GITHUB_CONTRACT_APP)("GitHub contract: github.com", () => githubContract(() => realTarget))
```

Rules that make it work:

- **Assert observable outcomes, not bytes.** Status, error type, which repos are visible, pagination
  completeness. Real IDs and timestamps differ.
- **Parse real responses with the fake's schemas.** fakegit's `IsGh*` shapes are grest-ts schemas. `.parse`
  of a real GitHub response fails on a missing or renamed field, which catches shape drift with no extra
  assertions.
- **Seeding is the target-specific half.** On the fake it's the admin API. On the real service it's a sandbox
  org/app, or real binaries: for FakeUserSystemd the real `SystemdAdapter` on a VM, and for FakeKrattHost real
  tmux/find. Those runs belong in the live-VM checks (`integration-tests/tests/test/checks/*`), importing the same
  scenario module that the fake-backed unit test imports.
- **Destructive or costly targets** (Hetzner) run on a schedule against a throwaway project, never per PR.

**Framework support?** No. It is `describe.runIf` plus a factory function, which is plain vitest. The parts that
make it grest-ts-flavoured already exist: schemas for parsing, `GGTest.startWorker` for the fake, and
`GGTestContext` for the clients. It belongs in the docs.

## 4. Recommendation

**Document the pattern; build no helper.** Reasons:

1. A base class would fit 1 of kratt's 5 fakes. It saves under 100 of fakegit's ~4.9k lines, and it adds an
   abstraction every grest-ts user must learn to save one-line `reset`s.
2. grest-ts already has every primitive a good fake needs:
   - `GGRuntime` to host it.
   - `GGHttpCodec` to speak a vendor's wire.
   - A normal contract for the admin API.
   - `GGTestContext` hooks for reset.
   - `config.update` and discovery to wire the app to it.
   - `@mockable` / `Api.mock` for one-off failures *inside* the fake.

   fakegit shows those are enough. "Apps can do this well with what grest-ts offers" applies here.
3. The valuable part is the discipline: realistic world-shaped faults, outcome assertions, contract runs
   against the real service. That's knowledge, which a README teaches better than a base class.

**Scope of the doc** (testkit README, new section "Fakes for third-party services", about 120 lines; ~½ day):

- When to use a fake versus `mockOf`. A fake is for code whose correctness *is* the protocol (auth,
  pagination, retries, webhooks).
- Out-of-process fakes: a `GGRuntime` per vendor; the vendor's wire via a custom `GGHttpCodec`; an admin
  contract for seed/reset; the app's base URL as a `GGSetting` that the test points at the fake.
- In-process fakes: `implements` the port; faults come from the world.
- The contract-check pattern above.
- Example: a trimmed fakegit (one REST route over a codec, `reset`, one fault, a hub flow wired to it).

**What kratt gains or deletes:**

- Doc only: nothing to delete. Optional cleanup: drop `FakeGitAdminApi.info` in favour of discovery
  (7 call sites).
- The real gain is the **contract suites**, which kratt adds itself. In order of value:
  - GitHub (fakegit vs a sandbox App, nightly): ~1–2 days.
  - FakeUserSystemd (vs the services live-VM check): ~1 day.
  - FakeKrattHost (vs a live-VM tmux check): ~1 day.
  - FakeProvider vs Hetzner: costs money; a scheduled run at most.

  These *add* tests. They don't delete any. They turn "answers like Hetzner" from a comment into a checked claim.

**Not recommended now, but the one framework-shaped idea worth noting:** use one `GGHttpSchema` for both sides of
a third-party API. A vendor codec with a client half would serve the app's GitHub client *and* fakegit's server.
That gives:

- Shape drift between our client and our fake becomes a compile error.
- Discovery wires tests automatically.
- `GitHubReposApi.mock/spy` work on the fake's routes.

The cost: a codec client half for every vendor wire quirk (Link pagination, raw media types), and rewriting
kratt's `httpClient` call sites. It also does nothing about drift from the *real* vendor, which is what
section 3 is for. Revisit if a second app writes a vendor fake.

## 5. Open questions for the owner

1. **Doc home.** The grest-ts testkit README (generic, with fakegit trimmed as the example), or a kratt doc
   (`kratt-testing` skill)? I lean to grest-ts, because the pattern isn't kratt-specific.
2. **Real-service contract runs.** Is a sandbox GitHub org + App (credentials in CI secrets, nightly) acceptable?
   Same question for a throwaway Hetzner project. Without them, section 3 covers only the VM-bound fakes.
3. **A testkit getter for a runtime's base URL** (`t.fakegit.url`), replacing `admin.info()` / `discoverApi`
   lookups. It's tiny and generic, but is it worth API surface?
4. **Shared vendor contract (client + fake from one schema).** Park it, or try it on one GitHub endpoint family
   to measure?
