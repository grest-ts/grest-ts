---
description: Audit code for grest-ts convention violations (contract-first, compose() wiring, testkit imports, config access)
argument-hint: "[path | --all] [--fix]"
allowed-tools: Bash(node:*), Bash(git:*), Read, Grep, Glob, Edit
disable-model-invocation: true
---

Review code for **grest-ts convention violations** and report them. grest-ts is a contract-first framework whose value comes from its conventions; this command audits adherence to them, combining a deterministic checker with semantic judgment.

`$ARGUMENTS` controls scope and behavior:
- **no args** (default): review the current diff — files changed on this branch.
- **a path** (e.g. `packages/api`): review every `.ts`/`.tsx` file under it.
- **`--all`**: review the whole repo (every tracked `.ts`/`.tsx`).
- **`--fix`**: after reporting, apply fixes for high-confidence findings (see step 6).

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

Pass the resolved files as arguments (batch if very many). Parse the JSON `findings`. Each has `file`, `line`, `rule`, `severity` (`error`|`warning`), `convention`, `message`, `snippet`. These are *candidates* — the script errs toward flagging.

## 3. Validate candidates (drop false positives)

Read the cited lines (with surrounding context) and discard any candidate that is:
- inside a comment, a string literal, a test fixture demonstrating the anti-pattern, or example/doc code;
- on a line the diff didn't touch (default scope only — for `--all`/path scope keep them);
- a `GR010` URL that is clearly a constant default, test seed, or doc `example:` value rather than live config;
- a `GR011` module-scope `.get()` that is genuinely a one-time constant, not overridable config;
- a `GR009` `ws`/`new WebSocket` inside framework-adapter or low-level code that legitimately wraps the transport.

Keep `error`-severity findings (GR001/GR002/GR003/GR004/GR005) unless you can clearly justify dropping one — they are mechanical (wrong import path, global mock, Express, routing decorator) and rarely wrong.

## 4. Semantic pass (what the script can't decide)

The checker only catches mechanical violations. Read the changed files and additionally check the **judgment-level** conventions from the bundled skill — load `${CLAUDE_PLUGIN_ROOT}/skills/grest-ts/SKILL.md` for the authoritative rules. Look for:

- **Not contract-first:** logic/routes defined without a `GGContractClass` contract; an impl whose method signatures drift from its contract.
- **Wiring outside `compose()`:** servers/clients/services instantiated and wired anywhere other than a `GGRuntime.compose()` override; DI containers or service locators in production code.
- **Bypassing the schema:** raw `fetch`/HTTP/socket to another service instead of `<Api>.createClient()` (the checker catches obvious libs; you catch the rest), or talking to a service without its typed client.
- **Missing `VALIDATION_ERROR`** on a mutation contract whose input can fail validation (without it, field errors coerce to `SERVER_ERROR` and never map back to the field).
- **`.parse` strips undeclared `IsObject` props** — a field that crosses the wire but isn't in the schema silently never arrives; flag fields used but not declared.
- **Schema without `.docs()`** on reusable/exported schemas (low severity).

Cite the SKILL.md section for each. Be conservative — flag a semantic issue only when you're confident, like a senior grest-ts reviewer would. Note: do **not** flag `implements I…Api` or prototype (`public async`) methods — grest-ts's own services use both idiomatically, so they are not violations despite older anti-pattern phrasing.

## 5. Report

Merge surviving script findings + semantic findings, dedupe by `file:line`, and print grouped by severity. Use `file:line` references (clickable). For each finding give a one-line description and the convention it violates. Format:

```
## grest-ts convention review — <N> finding(s)

### Errors (M)
- `path/to/File.ts:42` — <description>. (<convention, e.g. §6 — mockOf lives in @grest-ts/testkit>)

### Warnings (K)
- `path/to/File.ts:88` — <description>. (<convention>)
```

If nothing survives: "No grest-ts convention violations found across <N> file(s)." Keep it brief — no emojis, no preamble.

## 6. `--fix` (only if requested)

After reporting, apply fixes **only** for high-confidence, mechanical findings: wrong testkit import paths (GR001/GR002) and missing `SERVER_ERROR` in `errors:[]` (GR007, when you've confirmed the method should have it). Use `Edit`. Do **not** auto-rewrite architectural issues (compose() wiring, contract-first restructuring, replacing a hand-rolled client with `createClient()`) — list those as "manual fixes needed". After editing, re-run the checker on the touched files to confirm the findings cleared, and report what was changed vs. left manual.
