---
description: Audit code for grest-ts convention violations (contract-first, compose() wiring, testkit imports, config access)
argument-hint: "[path | --all] [--fix]"
allowed-tools: Bash(node:*), Bash(git:*), Task, Read, Grep, Glob, Edit
disable-model-invocation: true
---

Review code for **grest-ts convention violations** and report them. grest-ts is a contract-first framework whose value comes from its conventions; this command audits adherence to them, combining a deterministic checker with semantic judgment fanned out across parallel review agents.

`$ARGUMENTS` controls scope and behavior:
- **no args** (default): review the current diff — files changed on this branch.
- **a path** (e.g. `packages/api`): review every `.ts`/`.tsx` file under it.
- **`--all`**: review the whole repo (every tracked `.ts`/`.tsx`).
- **`--fix`**: after reporting, apply fixes for high-confidence findings (see step 5).

Follow these steps:

## 1. Resolve the file list

- **Default (diff):** find the base branch (`grest`/`main`/`master`/`dev` — whichever `git rev-parse --verify` resolves), then `git diff --name-only $(git merge-base HEAD <base>)...HEAD` **plus** `git diff --name-only HEAD` (uncommitted) and staged. Union them.
- **Path arg:** `git ls-files '<path>/**/*.ts' '<path>/**/*.tsx'` (fall back to `Glob` if not a git repo).
- **`--all`:** `git ls-files '*.ts' '*.tsx'`.

Filter to `.ts`/`.tsx` only. **Exclude** `*.d.ts`, `node_modules/`, `dist/`, `build/`, and generated client files (paths containing `.generated.` or under a `generated/` dir). If the list is empty, report "nothing to review" and stop.

## 2. Run the deterministic checker

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/grest-conventions-check.mjs" --json <file> <file> ...
```

Pass the resolved files as arguments (batch if very many). Parse the JSON `findings`. Each has `file`, `line`, `rule`, `severity` (`error`|`warning`), `convention`, `message`, `snippet`. These are *candidates* — the script errs toward flagging. Do **not** validate or drop them here; that happens inside the agents in step 3, each handed the candidates for its own rules.

## 3. Analysis — fan out 4 review agents in parallel

Launch **4 independent review agents** via the `Task` tool (`subagent_type: general-purpose`), all in a **single message** so they run concurrently. Each agent owns one convention area, validates the checker candidates for its rules, and runs the semantic pass the checker can't. Agents are **read-only** — they report findings, they never edit.

Give every agent this shared brief:
- The resolved file list and the scope (default-diff / path / `--all`).
- The checker candidates whose `rule` belongs to that agent (see the table).
- Instruction to load `${CLAUDE_PLUGIN_ROOT}/skills/grest-ts/SKILL.md` for the authoritative rules and to cite the relevant section on each finding.
- The shared validation rules below, so each drops its own false positives.
- Return format: a list of findings, each with `file`, `line`, a one-line `summary`, `convention` (e.g. `§6 — mockOf lives in @grest-ts/testkit`), `severity` (`error`|`warning`), and `autofixable` (`true` only for the mechanical fixes in step 5). Return an empty list if the area is clean. Report findings as data, not prose.

**Shared validation rules** (every agent applies to its own candidates — drop a candidate that is):
- inside a comment, a string literal, a test fixture demonstrating the anti-pattern, or example/doc code;
- on a line the diff didn't touch (default scope only — for `--all`/path scope keep them);
- a `GR010` URL that is clearly a constant default, test seed, or doc `example:` value rather than live config;
- a `GR011` module-scope `.get()` that is genuinely a one-time constant, not overridable config;
- a `GR009` `ws`/`new WebSocket` inside framework-adapter or low-level code that legitimately wraps the transport.

Keep `error`-severity checker findings (GR001/GR002/GR003/GR004/GR005) unless you can clearly justify dropping one — they are mechanical (wrong import path, global mock, Express, routing decorator) and rarely wrong. Be conservative on semantic findings — flag one only when you're confident, like a senior grest-ts reviewer would. Do **not** flag `implements I…Api` or prototype (`public async`) methods — grest-ts's own services use both idiomatically.

| Agent | Checker rules to validate | Semantic checks (read the files) | SKILL.md |
|---|---|---|---|
| **1 — Contract-first & impl drift** | GR004 (Express), GR005 (routing/DI decorators) | Logic/routes defined without a `GGContractClass` contract; an impl whose method signatures drift from its contract; routes not bound contract-first. | §1, §3, §11 |
| **2 — Wiring, DI & config** | GR010 (hardcoded URL/config), GR011 (module-scope config cache) | Servers/clients/services instantiated and wired anywhere other than a `GGRuntime.compose()` override; DI containers or service locators in production code; config read other than `GGSetting`/`GGSecret`/`GGResource` at point of use. | §4, §8, §10 |
| **3 — Schema boundaries** | GR009 (hand-rolled HTTP/socket) | Raw `fetch`/HTTP/socket to another service instead of `<Api>.createClient()`, or talking to a service without its typed client; `.parse` strips undeclared `IsObject` props — a field used but not declared in the schema silently never arrives. | §1, §9 |
| **4 — Errors, validation & testkit** | GR001/GR002 (testkit import paths), GR003 (global mocks), GR007 (missing SERVER_ERROR) | Missing `VALIDATION_ERROR` on a mutation contract whose input can fail validation (without it, field errors coerce to `SERVER_ERROR`); missing `SERVER_ERROR`; reusable/exported schema without `.docs()` (low severity). | §1, §2, §6, §7 |

## 4. Report

Wait for all 4 agents to complete. Merge their findings, dedupe by `file:line` (an issue can surface from more than one agent), and print grouped by severity. Use `file:line` references (clickable). For each finding give a one-line description and the convention it violates. Format:

```
## grest-ts convention review — <N> finding(s)

### Errors (M)
- `path/to/File.ts:42` — <description>. (<convention, e.g. §6 — mockOf lives in @grest-ts/testkit>)

### Warnings (K)
- `path/to/File.ts:88` — <description>. (<convention>)
```

If nothing survives: "No grest-ts convention violations found across <N> file(s)." Keep it brief — no emojis, no preamble.

## 5. `--fix` (only if requested)

After reporting, apply fixes **only** for high-confidence, mechanical findings (`autofixable: true`): wrong testkit import paths (GR001/GR002) and missing `SERVER_ERROR` in `errors:[]` (GR007, when the method should have it). Use `Edit`. Do **not** auto-rewrite architectural issues (compose() wiring, contract-first restructuring, replacing a hand-rolled client with `createClient()`) — list those as "manual fixes needed". After editing, re-run the checker on the touched files to confirm the findings cleared, and report what was changed vs. left manual.
