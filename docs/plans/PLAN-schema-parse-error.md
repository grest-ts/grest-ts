# Schema `parse()` / `assert()` throw a real `Error`

## Problem

`GGSchema.parse()` and `GGSchema.assert()` throw a bare `GGIssuesList` (`packages/schema/schema/src/GGSchema.ts`,
the two `throw issues`). It isn't an `Error`, so the throw has no stack trace. In a handler, `ERROR.fromUnknown`
turns it into `SERVER_ERROR({debugData: issues})`, and the log can't say where the bad data was parsed. The main
case is an adapter parsing a third party's response (`IsGhToken.parse(res)`).

`GGIssuesList` must **not** extend `Error`. It's a collector created on every parse, successful ones included, and
capturing a stack each time would cost the hot path.

## Change

1. New `GGParseError extends Error` in `packages/schema/schema/src/issue/` (next to `GGIssuesList`), exported from
   both `index-node.ts` and `index-browser.ts`. Follow the existing style (`GGConfigLoadError`):

   ```ts
   export class GGParseError extends Error {
       public override readonly name = "GGParseError"
       constructor(public readonly issues: GGIssuesList) {
           super(issues.toString())        // "Validation failed: path: message; …" (no failing values)
       }
   }
   ```

   `toString()`/`toMessage()` print no failing values (by design), so the message is safe to log. Keep it that way.
2. `parse()` and `assert()` throw `new GGParseError(issues)`. `safeParse()` and `GGIssuesList` are unchanged.
3. Check `ERROR.fromUnknown` / `ERROR.anyToText` (`packages/schema/schema/src/contract/ERROR.ts`): a thrown
   `GGParseError` must become `SERVER_ERROR` with the parse error as `originalError`, and the rendered log must show
   its stack and message. Nothing should need changing there; confirm it with a test.
4. Tests in the schema package:
   - `parse` and `assert` throw `GGParseError`, `e.issues` holds the list, and the message has no failing value
     (use a value like a secret string and assert it's absent).
   - A handler that calls `.parse` on bad data answers `SERVER_ERROR`, and the logged text includes
     `GGParseError` and the stack.
5. Docs: wherever the schema README describes `parse` throwing, say it throws `GGParseError` (`e.issues`). Grep
   the READMEs and the plugin skill copies under `.claude-plugin/` for "throws GGIssuesList" or similar wording.

## Finding what it breaks

Code that caught the thrown value **and used it as a `GGIssuesList`** breaks. The type name won't find every case,
because a catch block uses the value duck-typed. Search grest-ts, kratt (`/workspace/kratt`) and react-kit
(`/workspace/react-kit`), skipping `node_modules`:

- `instanceof GGIssuesList`, `as GGIssuesList`, `GGIssuesList` in general.
- A `catch` around `.parse(` / `.assert(` that calls `.toJSON()`, `.toMessage()`, `.some(`, `.length`,
  `.getPath(`, `.getIssue(`, `.getMessage(` or `.toString()` on the caught value. Grep for `.parse(` and
  `.assert(` inside `try` blocks; read each hit.
- A `catch` that tells parse failures apart from other errors by `instanceof Error` (that branch now flips).
- Tests that pin the old behaviour: `toThrow(GGIssuesList)`, `rejects.toBeInstanceOf(GGIssuesList)`, or
  `toThrow("Validation failed…")` (the message stays the same, so this one should still pass).
- `String(e)` / template literals on the caught value: before, `GGIssuesList.toString()` gave
  `Validation failed: …`. `Error.toString()` now gives `GGParseError: Validation failed: …`. Check any test or
  log assertion matching the old string exactly.

Fix each hit in the same PR: grest-ts hits in grest-ts, kratt hits in a kratt PR. Use `e.issues` where the list
is needed, or `safeParse` where the code only wants a result. List every hit and its fix in the PR description.

## Verification

- grest-ts: the schema package's tests, plus every other package with a hit. Run one vitest process at a time.
- kratt runs against this checkout: `/workspace/kratt/node_modules/@grest-ts/*` symlinks to `/workspace/grest-ts`.
  So **work in `/workspace/grest-ts` itself, not in a separate worktree**, or kratt won't see the change. Run
  `npm run typecheck` in kratt, plus the test files of the packages with hits and a sample of hub flows
  (`integration-tests/mixed-tests-bag`). Never run the full kratt suite: under 30 GB RAM it takes the machine down.
  kratt warns that grest-ts is off its pin; that's expected.

## Out of scope

- A `parse(value, {error: X})` shorthand. Decided against; use `safeParse` + throw.
- Changing `VALIDATION_ERROR` for contract input (`GGContractExecutor.parseInput`); it already uses `safeParse`.
- `GGIssuesList` internals.

## Delivery

- grest-ts branch `kratt/schema-parse-error`, PR against `dev`. The description must state the breaking change: a
  caught parse failure is `GGParseError` with `.issues`, no longer `GGIssuesList`. There's no changelog file, so the
  PR description is the record.
- A kratt PR only if kratt has hits (branch `kratt/schema-parse-error`), noting that it needs the grest-ts release
  or a `grest:pin` bump.
