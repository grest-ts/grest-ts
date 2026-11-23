# Plan: act on the kratt-agentwire architecture review

Source: `kratt-agentwire/docs/ideas/ARCH_REVIEW_kratt-agentwire.md` (at agentwire `33b4064`).
**All code changes are in the `kratt-agentwire` repo (Go).** This flow runs in `grest-ts`; see Q0.

## What we do

1. **One status reducer (`turnState`) with table tests**, the review's single proposal (§3), in two PRs.
2. **Use the transcript path the agent reports** instead of deriving it (watch-list item, fixes kratt-agentwire#34).
3. Nothing else from the watch list now (reasons below).

## Verified against the code

Every claim the plan builds on was checked with grep at `33b4064`:

- Status fields live on `Session` (`internal/controller/session.go:66-77`): `status`, `phase`, `phaseBy`, `screen`,
  `idlePolls`, `turnSeen`, `turnAt`, `waits`.
- Writers:
  - `hook()` `requests.go:41-66`
  - `pollScreen()` `session.go:509-538` (two switches)
  - `flushOutbox()` `activity.go:129`
  - `loadActivity()` `activity.go:288`
  - lifecycle: takeover `lifecycle.go:464-466`, `startedLocked` `:481-489`, `markStopped` `:666-673`
- The review missed one writer: the takeover branch at `lifecycle.go:464` sets `turnSeen = true` when the agent is
  still alive. It gets its own method below.
- Timing constants: `idleAfter`, `turnGrace` (`session.go:34-35`) and `phaseGrace` (`:38`).
- `hooked()` is `HookBase != ""` (`session.go:174`). `HookBase` is set only when there is a TCP listener
  (`cmd/agentwire/main.go:242-246`).
- `TranscriptPath(cwd, id)` callers: `session.go:181`, `session.go:695`, `lifecycle.go:131`, `lifecycle.go:569`,
  `adapter/claude/claude.go:208`. The SessionStart hook (`adapter/claude/hooks.go:151`) reads only `session_id` today.

## 1. `turnState` reducer

### Design

New file `internal/controller/turnstate.go`:

```go
type turnState struct {
    status    protocol.Status
    phase     protocol.Phase
    phaseBy   time.Time
    screen    adapter.Screen
    idlePolls int
    turnSeen  bool
    turnAt    time.Time
    waits     map[string]bool
}

func (t *turnState) onHook(h adapter.Hook, now time.Time)
func (t *turnState) onScreen(scr adapter.Screen, hooked bool, now time.Time)
func (t *turnState) onSent()                       // flushOutbox: working until the hook/spinner shows it
func (t *turnState) onLoad(saved protocol.Status)  // loadActivity
func (t *turnState) onTakeover(alive bool)         // lifecycle.go:464: alive → turnSeen; else stopped
func (t *turnState) onStart(now time.Time)         // startedLocked
func (t *turnState) onStop()                       // markStopped
```

- `turnState` is a plain value: no I/O, no locks, no clock reads. `Session` embeds it as `s.turn` and calls it
  under `s.mu`, then broadcasts as today.
- The constants `idleAfter`, `turnGrace` and `phaseGrace` move into `turnstate.go`.
- Side effects that are not turn state stay in `Session`:
  - `live`, `toolUses` and `settleAll()` on an idle hook (`requests.go:68-72`)
  - `clearActivity()`, `reported` and `target`
  - `answerStartupDialog` and `broadcastState`

  `hook()` checks `h.Status == protocol.StatusIdle` itself, as today. The reducer returns no "changed" flag:
  every caller broadcasts anyway.
- Readers (`stateLocked` `session.go:654-659`, `activity.go:90`, `:259`, `lifecycle.go:587`) read `s.turn.status`
  and the other fields directly. No getters.

Rejected alternatives:

- **Do nothing.** The review calls the repo healthy. But three of its post-rewrite fixes (`0d3f1da`, `cd54562`,
  `5fb6025`) are in exactly this logic within one week, and today the only way to test it is tmux plus
  `fakeagent`.
- **Table-test `pollScreen`/`hook` on a real `Session`.** A `Session` needs a `Controller`, an adapter and a `run`
  (`quietController` in `lifecycle_internal_test.go` shows the setup). The tests would still read the wall clock,
  because `time.Now()`/`time.Since` are inline. That is more setup and still flaky.
- **A state-machine library or an event-type enum.** These are speculative. Seven methods on a struct is enough.

### PR A: extract it (no behaviour change)

- Move the field writes verbatim into the methods. `time.Now()`/`time.Since` become `now`.
- In `hook()`, `pollScreen()`, `flushOutbox()`, `loadActivity()`, the takeover branch, `startedLocked()` and
  `markStopped()`, replace the field writes with one call each.
- Keep any inconsistency the moved code already has. For example, `markStopped` does not reset `turnSeen` or
  `phaseBy`, while `startedLocked` does. Changing that is not part of this PR.
- `turnstate_test.go` (internal package test, plain `testing`): a table where each row is a sequence of
  `{at, event}` steps and the expected `status`/`phase` after each step. Rows:
  - Prompt hook, no spinner for 1 s, then Stop → working, working, idle
  - Prompt hook, never a spinner (interrupt before draw), idle screens past `turnGrace` → idle
  - Prompt hook, spinner, interrupt (no Stop), `idleAfter` idle polls → idle
  - Dialog on screen → waiting; dialog closes, no spinner yet → working (not idle)
  - Subagent `UntilHook` wait, idle screens → stays working; main agent's next call does not end the subagent's
    wait (`cd54562`); that subagent's next call ends it (`5fb6025`)
  - Subagent call settles a wait, unhooked session still reaches working (`0d3f1da`)
  - Unhooked: spinner on an idle session → working; spinner gone for `idleAfter` polls → idle
  - Phase from a hook, screen never shows it, past `phaseGrace` → phase cleared; phase spinner replaced by another
    spinner → cleared
  - `onSent` on idle → working, then idle screens before `turnGrace` keep working
  - `onStart` → starting; idle screens → idle; `onStop` → stopped, waits cleared
- Rows are written against today's code first, so they pin current behaviour. A row that shows a bug is noted in
  the PR, not fixed in it.

### PR B: slim the e2e timing tests

- `activity_test.go`: drop the tmux/`fakeagent` cases whose only assertion is a timing case now covered by a row.
  Keep one happy-path e2e per writer: hook-driven turn, screen-only interrupt, send, restart restore.
- Done only after PR A is merged, so that coverage overlaps for one release.

### Q1-dependent (not planned unless the owner says so)

If socket-only mode is not needed, a later PR deletes the `!hooked` branch (`session.go:518`) and makes `serve`
always open a loopback hook listener. Until then the branch stays, with its own rows.

## 2. Reported transcript path (kratt-agentwire#34)

- `adapter.Hook` gets `TranscriptPath string`, set from SessionStart's `transcript_path`
  (`adapter/claude/hooks.go:151`).
- `protocol.SessionRecord` gets `TranscriptPath string \`json:"transcriptPath,omitempty"\``. Per the repo rule, the
  change starts in `protocol/schema.json` (`SessionRecord` at line 1181), then the Go type. It is not on the viewer
  wire, so there is no `ProtocolVersion` bump.
- `follow()` (`session.go:216`) stores it on `s.rec` together with the agent session id, and persists it.
- `Session` gets `transcriptPath(id)`: it returns `rec.TranscriptPath` when `rec.AgentSessionID == id`, otherwise
  the adapter's `TranscriptPath(s.cwd, id)`. It is used at `session.go:181`, `session.go:695` and
  `lifecycle.go:569`.
- `lifecycle.go:131` (resume by id from the API) keeps the derived path. No hook has run yet; the caller names the
  cwd.
- `claude.go:208` derives the subagent launcher's transcript from `cwd`. Change `Adapter.Subagents(cwd, sessionID)`
  to `Subagents(transcriptPath string)`: the subagent dir is next to the transcript. This updates the
  claude/terminal/codex/gemini adapters' signatures (the last three return nil).
- Caveat: `DecodeSessionRecord` uses `DisallowUnknownFields`, so an older agentwire refuses records written by the
  new one. A downgrade then drops sessions. That is acceptable for a pre-1.0 daemon that kratt pins; say so in the PR.
- Tests:
  - Adapter: a unit test that SessionStart's payload yields the path.
  - Controller: an integration test where `fakeagent` reports a transcript in a different dir (as `--worktree`
    does) and the chat shows its entries. Check whether `fakeagent` needs a flag for that.

## Not doing now, and why

| Watch-list item | Decision |
|---|---|
| Startup dialogs matched by label | kratt pre-writes trust; one breakage. Moving the trust write into the adapter's `Launch` is the review's own "small follow-up"; leave it as a kratt-agentwire issue, not this run. |
| Lifecycle races | Watch only; no current bug. |
| Long messages as paste (#21), subagent transcripts read whole (#40/#51) | Feature gaps with their own issues. |
| Committed `dist/` (#48) | Separate CI decision; it has its own issue. |

## Contracts, security, data

- **Contracts.** No HTTP route or viewer message changes. The only schema change is `SessionRecord.transcriptPath`
  (stored state, not on the wire).
- **Security.** Hooks are already authenticated by the per-session `HookSecret`. The new value is a path that our
  own agent reports and that we only read. Nothing new is listened on, no token is logged, and there is no egress.
  None of this touches kratt's relay callbacks or the two-user model.
- **Data.** One optional field in the session JSON files. No migration: an empty value falls back to the derived
  path. **Deploy:** agentwire release only. kratt picks it up by bumping the pinned binary; nothing in kratt
  changes.

## Size

| PR | Net LOC |
|---|---|
| A (`turnstate.go`) | ~+120 moved / −90 at call sites, plus ~200 test lines |
| B (e2e cleanup) | ~−100 to −150 |
| Transcript path | ~+60 code, ~+60 tests |

No new package.

## Open questions for the owner

- **Q0. Wrong repo for this run.** The flow works in `grest-ts`, but every change is in `kratt-agentwire`. Should the
  build steps run in `kratt-agentwire`, with this run restarted on that repo? Or should the builder work in
  `/workspace/kratt-agentwire` on its own `kratt/*` branch?
- **Q1. Is socket-only (unhooked) mode needed by anyone besides kratt?** kratt always passes `--listen`. If not, a
  follow-up deletes the screen-only status path.
- **Q2. Are kratt-agentwire#40 and #51 the same request?** If so, close one. This does not block the plan.
