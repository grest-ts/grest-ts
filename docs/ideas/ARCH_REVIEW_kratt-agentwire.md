# Architecture review: kratt-agentwire

Scope: the whole `kratt-agentwire` repo at `beaf111` (master, 2026-11-23). The history is short: 266 non-merge
commits between 2026-11-17 and 2026-11-23. So "churn" here means one week of building, not three months of upkeep.

## 1. Health summary

Healthy. The boundaries the repo sets for itself hold. Only `internal/termhost` runs tmux, and no controller or
protocol file names Claude (a grep for `claude` in `internal/controller` and `protocol` finds nothing). The biggest
simplification has already landed: `5796d9a` (2026-11-22) made hooks the source of state and deleted discovery and
transcript guessing (−1997/+1149 lines).

One root cause is still visible after that rewrite. A session's status is merged from hooks, screen polls and
timers, and it is written from five places across about nine fields. Some of its evidence comes from before the
rewrite; that shows the pattern is old, not that those bugs are still open. There is one proposal; everything else
is on the watch list.

## 2. Patterns found

### P1. Session status is written in five places, from three sources, with timing guesses

The state lives in `Session` (`internal/controller/session.go:66-77`, `:109-111`): `status`, `phase`, `phaseBy`,
`screen`, `idlePolls`, `turnSeen`, `turnAt`, `waits`, and `failed`/`retryAt`. Five places write it:

- `hook()` in `internal/controller/requests.go:44-66` sets the hook's status, the waits and the phase, and resets
  `idlePolls`.
- `pollScreen()` in `internal/controller/session.go:509-537` runs a five-case `switch` over the screen's busy and
  dialog flags, `hooked()`, `waits`, `turnSeen`, `turnGrace` and `idleAfter`. A second switch then applies
  `phaseGrace`.
- `flushOutbox()` in `internal/controller/activity.go:129` forces `working` after a send, because "the agent's
  hook or spinner takes a moment to show it".
- `loadActivity()` in `internal/controller/activity.go:288` restores the status from saved activity when a session
  loads.
- Lifecycle code in `internal/controller/lifecycle.go:466, 483, 668` sets starting and stopped, and resets the same
  fields.

Each writer carries its own comment about a race with the others. The TUI draws its spinner late, an interrupt
fires no hook, and a dialog closes before the spinner comes back. The only way to test these rules today is end
to end, with real tmux and `fakeagent`.

Fix commits after the `5796d9a` rewrite, against the current code:

- `0d3f1da`: subagent calls had to settle waits, and unhooked sessions had lost `working`.
- `cd54562`: waits had to be tracked per agent.
- `5fb6025`: a wait ends with that agent's next call.

Before the rewrite, on code that no longer exists, the same kind of fix appeared in `3ce3b8a`, `fe6f974`,
`cca9087`, `a35b631` and `3c7e536`. `3ce3b8a` reverted a rule that `fe6f974` had just changed. These commits show
the pattern predates the rewrite; they are not current bugs.

### Watch list (fewer than two current bugs each, or not verified)

- **Startup dialogs are answered by matching their labels.** These are `startupDialogs` in
  `internal/controller/session.go:550` and `FolderTrust`/`OrgSettingsApproval` in
  `internal/adapter/claude/input.go:119-140`.
  - One real breakage so far: `10dc477`. Claude Code 2.1.330's `--add-dir` dialog had new labels, and
    trustFolders sessions hung on it.
  - Trust is not saved after agentwire answers (kratt-agentwire#52).
  - For kratt, the only embedder, this is already handled. kratt writes `hasTrustDialogAccepted` for the launch
    dir and every `--add-dir` repo before each launch (kratt `190f5b919`), using per-path, serialized, atomic
    writes (`73f8266db`). The on-screen answer is only the fallback.
  - Small possible follow-up: move that write into the Claude adapter's `Launch`, so that other embedders get it
    too.
- **The transcript location is derived, not reported.** `TranscriptPath(cwd, id)` is computed at
  `internal/controller/session.go:181`, `:695`, `internal/controller/lifecycle.go:131`, `:569`, and in the subagent
  launcher at `internal/adapter/claude/claude.go:208`. The SessionStart hook already carries `transcript_path` and
  `cwd`.
  - This causes kratt-agentwire#34: `claude --worktree` gives an empty chat.
  - It is one issue, and the fix is cheap: record the hook's path on `rec` and use it at all five call sites.
- **Session lifecycle races.** The `lifecycle` mutex and the `forgone`, `removed` and `inPane` flags are in
  `session.go:48-50, 103-106`. `5fb6025` ordered takeover, resume and forget per session after the rewrite. Watch
  whether more fixes follow.
- **Long messages reach Claude as a paste** (kratt-agentwire#21). This lives in the adapter's `SendText`. I did
  not analyse it further.
- **Workflow subagent transcripts are read whole** (kratt-agentwire#40, #51). This is a feature gap, not a design
  flaw.
- **`client/dist` and `web/dist` are committed.** 126 commits touch them. CI's stale-dist check catches drift, and
  kratt-agentwire#48 proposes building them in CI instead.

## 3. Proposal: one status reducer, a pure value with table tests

**Design.** Move `status`, `phase`, `phaseBy`, `screen`, `idlePolls`, `turnSeen`, `turnAt` and `waits` into one
`turnState` struct in its own file. Its methods take one observation plus `now`, and return whether anything
changed:

- `onHook(h adapter.Hook, now)`
- `onScreen(scr adapter.Screen, hooked bool, now)`
- `onSent(now)`
- `onLoad(saved protocol.Status)`
- `onStart()` / `onStop()`

`turnState` does no I/O and takes no locks. `Session` calls it under `s.mu` and broadcasts. The timing rules
(`turnGrace`, `idleAfter`, `phaseGrace`) live in that one file, next to a table test. The test replays event
sequences such as these:

- "Prompt hook, no spinner for 1 s, Stop"
- "subagent asks, then the main agent's next call"
- "unhooked: spinner appears, then disappears"

**What it would have caught.** The post-rewrite fixes `0d3f1da`, `cd54562` and `5fb6025` each become a table row.
Those fixes changed how waits and the unhooked path combine. Today, a change there is caught only by an end-to-end
test with tmux, or by review.

**What it deletes.** The five scattered writers (about 60 lines across `requests.go`, `session.go`, `activity.go`
and `lifecycle.go`) become calls. Timing cases move out of the tmux/`fakeagent` tests in `activity_test.go`; those
tests keep one happy-path check each.

**Migration** (each step ships on its own):
1. Extract `turnState`, moving the code verbatim. Add table tests that pin today's behaviour, including the three
   fix cases above. No behaviour change.
2. Route `flushOutbox`, `loadActivity` and the lifecycle resets through `onSent`, `onLoad`, `onStart` and
   `onStop`. Remove the direct field writes from those files.
3. Depending on Q1, delete the unhooked branch (`!s.hooked()` at `session.go:518`) or keep it as its own set of
   tested rows.

**Risks.** The verbatim move is low risk. The table tests use synthetic times, so they are only as good as our
model of Claude's TUI timing. Keep the real screen captures and the fakeagent e2e tests as the check against
reality.

**Size.** Small to medium: about 150 lines moved, 150–250 lines of tests, 2–3 PRs.

## 4. Requirements questions for the owner

- **Q1. Is socket-only (unhooked) mode needed?**
  - Without a TCP listener, `HookBase` is empty (`cmd/agentwire/main.go:242-246`). Status then comes from the
    screen alone (`session.go:518`), and there are no context replies (`activity.go:141`).
  - kratt always passes `--listen` (`kratt/src/plugins/ai/plugin/src/vm-manager/agentwire.ts:41`).
  - If no other embedder needs socket-only mode, `serve` could always open a hook listener, for example on an
    internal loopback port. The unhooked status branch would then go away.
- **Q2. Are kratt-agentwire#40 and #51 the same request?** If so, close one of them.

The Codex and Gemini stores are not in question. kratt's `AgentConversations.ts` lists, archives, exports and
deletes conversations through them for its ai-cli-codex and ai-cli-gemini plugins.
