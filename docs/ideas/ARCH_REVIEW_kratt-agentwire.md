# Architecture review: kratt-agentwire

Scope: the whole `kratt-agentwire` repo at `beaf111` (master, 2026-11-23). History is short: 266 non-merge commits
between 2026-11-17 and 2026-11-23, so "churn" here means one week of building, not three months of upkeep.

## 1. Health summary

Healthy overall. The boundaries the repo sets for itself hold: only `internal/termhost` runs tmux, and no controller
or protocol file names Claude (grep for `claude` in `internal/controller` and `protocol` returns nothing). The big
simplification already landed in `5796d9a`, which made hooks the state source and deleted discovery and transcript
guessing (−1997/+1149 lines). One root cause still produces most of the fix commits: **the session's status is a
heuristic merge of hooks, screen polls and timers, written from four places across about nine fields.** The second,
smaller one is that startup dialogs are answered by matching on-screen labels, which breaks when a Claude release
renames them.

## 2. Patterns found

### P1. Session status is decided in four places, from three sources, with timing guesses

State lives in `Session` (`internal/controller/session.go:66-77`, `:109-111`): `status`, `phase`, `phaseBy`,
`screen`, `idlePolls`, `turnSeen`, `turnAt`, `waits`, `failed`/`retryAt`. These places write it:

- `hook()` in `internal/controller/requests.go:44-66`: hook status, waits, phase, and a reset of `idlePolls`.
- `pollScreen()` in `internal/controller/session.go:509-537`: a 5-case `switch` that combines screen busy/dialog,
  `hooked()`, `waits`, `turnSeen`, `turnGrace`, `idleAfter`, and then a second switch for the phase grace.
- `flushOutbox()` in `internal/controller/activity.go:129`: forces `working` after a send, because "the agent's
  hook or spinner takes a moment to show it".
- lifecycle in `internal/controller/lifecycle.go:466, 483, 668`: starting, stopped, and a reset of the same fields.

Each writer has its own comment about a race with the others (the TUI draws its spinner late, a spinner lingers
after Stop, an interrupt fires no hook, a dialog closes before the spinner returns). The rules have only been
testable end to end, with real tmux and `fakeagent`, so each timing case was found in review or live and patched in
place.

Bugs and fix commits behind it:
- `3ce3b8a`: reverts an edge-detection rule that "missed short turns and post-dialog spinner lag" and goes back to
  a 2 s guard. The rule had been changed again a commit or two earlier (`fe6f974`: "a closed dialog is work only
  once the spinner shows").
- `cca9087`: background subagents flickered the agent's status.
- `0d3f1da` and `cd54562`: waits had to become per-agent and be settled by subagent calls, and unhooked sessions
  lost `working` and got it back.
- `a35b631`: a tool waiting for permission did not read as waiting.
- `3c7e536`: after an interrupt, the idle status and the background list disagreed.
- `33f0260` (UI): "turns too short to show as working", a symptom on the UI side of the same guard.
- `a93c3d7`: a chat test needed "a status step that can't race".

### P2. Startup dialogs are answered by matching on-screen labels

`startupDialogs` (`internal/controller/session.go:546-560`) and the adapter's `FolderTrust` / `OrgSettingsApproval`
(`internal/adapter/claude/input.go:119-140`) find the dialog by its exact option text, then press keys after
`startupWait`, because "Claude Code ignores an answer within a second of the dialog appearing".

Bugs and fix commits behind it:
- `10dc477`: Claude Code 2.1.330 added an `--add-dir` trust dialog with new labels, and trustFolders sessions hung
  on it.
- `deb1e09`: `--add-dir` was dropped because it opened a trust dialog on every start.
- kratt-agentwire#52 (open): the answer agentwire picks doesn't persist trust (`hasTrustDialogAccepted = false`
  afterwards), so every launch depends on the labels matching.
- `af8a90d`: "each startup dialog its own wait".

### Watch list (fewer than two bugs each, or not verified)

- **Transcript location is derived, not reported.** `TranscriptPath(s.cwd, id)` is computed at
  `session.go:181`, `:695` and `lifecycle.go:131`, `:569`, while the SessionStart hook already carries
  `transcript_path` and `cwd`. This causes kratt-agentwire#34 (`claude --worktree` gives an empty chat). It's one
  issue, but the fix is cheap: record the hook's path on `rec` and use it in place of the derived one.
- **Session lifecycle races.** `lifecycle` mutex, `forgone`, `removed` and `inPane` (`session.go:48-50, 103-106`).
  Fixes `93d12de`, `769e66f` and `0d3f1da` touched them, but `5796d9a` removed the discovery code most of them were
  about. Watch whether new fixes appear now that discovery is gone.
- **Long messages are delivered as a paste** (kratt-agentwire#21). The cause is in the adapter's `SendText`. Not
  analysed further here.
- **Workflow subagent transcripts read whole** (kratt-agentwire#40 and #51, which look like duplicates). This is a
  feature gap, not a design flaw.
- **Committed `client/dist` and `web/dist`.** 126 commits touch them. CI has a stale-dist check, so drift is
  caught, but every UI change carries a rebuilt bundle. kratt-agentwire#48 already proposes building it instead.

## 3. Proposals

### Proposal 1: one status reducer, as a pure value with table tests (recommended)

**Design.** Move `status`, `phase`, `phaseBy`, `screen`, `idlePolls`, `turnSeen`, `turnAt`, `waits` into one
`turnState` struct in its own file. It gets a few methods that take an observation and `now`, and return whether
anything changed:

- `onHook(h adapter.Hook, now)`
- `onScreen(scr adapter.Screen, hooked bool, now)`
- `onSent(now)`
- `onStart()` / `onStop()`

The struct does no I/O and takes no lock; `Session` calls it under `s.mu` and broadcasts. All the timing rules
(`turnGrace`, `idleAfter`, `phaseGrace`, spinner linger) live in this one file, next to a table test that replays
sequences like "Prompt hook, no spinner for 1 s, Stop" or "dialog closes, spinner after 400 ms, subagent hook".

**Would have prevented / caught early:** each case in P1's list becomes a row in the table. `3ce3b8a`'s
regression (short turns, post-dialog spinner lag) would fail a unit test instead of being found live.

**Deletes:** the four scattered writers (about 60 lines spread across `requests.go`, `session.go`, `activity.go`
and `lifecycle.go`) become calls. Timing-sensitive cases leave the tmux and `fakeagent` tests (`activity_test.go`,
`a93c3d7`-style e2e race guards), which keep one happy-path check each.

**Migration (each step ships alone):**
1. Extract `turnState` with the code moved verbatim. Add table tests that pin today's behaviour, including the
   cases from the commits above. No behaviour change.
2. Route `flushOutbox` and the lifecycle resets through `onSent` / `onStart` / `onStop`. Drop the field writes
   from those files.
3. Depending on question Q1, delete the unhooked branch (`!s.hooked()` at `session.go:518`), or keep it as a
   separate tested row set.

**Risks.** Moving the code verbatim is low risk. The table tests use synthetic times, so they can only be as good
as our model of Claude's TUI timing. Keep the real captures and fakeagent e2e as the check against reality.

**Size.** Small to medium: about 150 lines moved, 150–250 lines of tests, 2–3 PRs.

### Proposal 2: record folder trust in Launch, keep screen answering only as a fallback

**Design.** For a session with `trustFolders`, the Claude adapter's `Launch` marks the folder trusted in the
agent's own config before the agent starts. The adapter already owns Claude's files (hook settings), so this stays
inside the "only adapters know agent files" rule. `startupDialogs` keeps answering by label as a fallback, and
emits a visible event when it does, so a label change after an upgrade shows up instead of hanging silently.

**Would have prevented.** kratt-agentwire#52 (trust never saved). For the plain folder trust dialog, it also
prevents `10dc477`-style hangs on a renamed label. The `--add-dir` dialog that `deb1e09` avoided by dropping
`--add-dir` may need the same treatment.

**Deletes.** Little code. Its value is that a launch no longer depends on screen labels in the common case.

**Migration.**
1. Find out which option or config key Claude actually persists (the open question in #52).
2. Write it in `Launch`, and add a test that a relaunch shows no dialog.
3. Downgrade dialog answering to a fallback with an event.

**Risks.**
- Claude rewrites `~/.claude.json` while it runs, so a concurrent write could be lost or clobber other state. The
  write must happen before the spawn and preserve the file's other keys.
- This partly reverses `f7386ed`, which stopped apps from pre-writing trust records. Here the writer is
  agentwire's adapter, not an app, but the owner should confirm (Q3).

**Size.** Small, 1–2 PRs.

## 4. Requirements questions for the owner

- **Q1. Is socket-only (unhooked) mode needed?** Without a TCP listener, `HookBase` is empty
  (`cmd/agentwire/main.go:242-246`), and status comes from the screen alone (`session.go:518`), with no context
  replies (`activity.go:141`). kratt always passes `--listen` (`kratt/src/plugins/ai/plugin/src/vm-manager/agentwire.ts:41`).
  If no other embedder needs socket-only, `serve` could require a hook listener (for example an internal loopback
  port), and the unhooked status branch would go away.
- **Q2. Codex and Gemini adapters are stores only** (`cmd/agentwire/main.go:151`). They serve
  `/api/conversations` listing and deletion. Is that used for those agents today, or kept for the roadmap?
- **Q3. Proposal 2 versus `f7386ed`:** may agentwire's Claude adapter write Claude's trust record itself, or should
  trust stay an on-screen answer only?
- **Q4. kratt-agentwire#40 and #51** look like the same request. Close one?
