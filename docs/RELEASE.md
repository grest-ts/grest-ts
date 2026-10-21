# Release process

Internal notes for the maintainer running releases. Not user-facing docs.

## TL;DR

- Work on `dev`. Merge to `release` when you want to ship. The action does the rest.
- `master` is bot-only — only successful releases land there. Always reflects "last released code."
- If something fails on `release`, master and dev stay clean.

## Branches

| Branch | Who pushes | Purpose | Triggers |
|---|---|---|---|
| `dev` | humans | daily work | nothing |
| `release` | humans (merge from dev) | "I want this released" | CI workflow |
| `master` | only `github-actions[bot]` | last successful release | publish workflow (via CI completion) |

## The release flow

A push to `release` runs `.github/workflows/ci.yml`:

1. Install deps, init test databases.
2. `grest.1.check.ts` — typecheck, regen everything, validate generated files match.
3. `grest.2.vitest.ts` — full test suite.
4. `grest.3.ver.patch.ts` — bump root `package.json` patch, propagate via `npm run generate`.
5. Commit the bump + every regenerated file (`git add -A`) as `v0.0.x`. Annotated tag.
6. Push the bump commit to `master` (`HEAD:refs/heads/master --follow-tags`).
7. Push the same commit to `dev` (`HEAD:refs/heads/dev || warning`). Silent fail is OK.

If steps 1–3 fail: nothing else runs. `release` stays at the failed commit; master and dev untouched. Fix forward.

If step 6 fails (master FF rejected): something was off about the branch shape — release was not a descendant of master. Manual recovery needed.

After CI completes successfully, `.github/workflows/publish.yml` triggers via `workflow_run`:

1. Checkout `master` (NOT `workflow_run.head_sha`, which points at the pre-bump release tip).
2. `grest.4.build.ts` — assemble dist/.
3. `grest.5.npm.publish.ts` — publish to npm registry.
4. Same script with `--skip-auth-check` — publish to GitHub Packages.

`publish-helpers.ts` skips packages that are already at the target version, so re-running publish is idempotent if it half-succeeded.

## Concurrency

CI workflow uses:

```yaml
concurrency:
  group: ${{ github.ref == 'refs/heads/release' && 'release' || format('ci-{0}', github.ref) }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/release' }}
```

Two pushes to `release` queue serially — never run in parallel — so we can't race a double publish. Other refs cancel-in-progress as before.

## Required setup

### Repo secrets

- `NPM_TOKEN` — npm publish token, write access to `@grest-ts` scope.
- `GITHUB_TOKEN` — auto-provided. Used for git pushes (master + dev) and GitHub Packages publish.

### Branch protection on `master`

In GitHub UI → Settings → Branches → branch protection rule for `master`:

- ✅ Restrict who can push to matching branches → allow only `github-actions[bot]`.
- ❌ Require pull request reviews (bot doesn't open PRs).
- ❌ Require status checks (bot already validated before pushing).
- ❌ Require linear history (FF push is linear by construction; rule is harmless if on).
- Allow force pushes: only via the bot identity (only relevant if you ever need `--force-with-lease`).

Without this, anyone with write access can push directly to master and the "always reflects last release" invariant breaks. The pipeline still works without it — it's policy, not mechanism.

### No protection on `release` or `dev`

`release` is intentionally writable by humans — that's the trigger. `dev` is daily work.

## Common operations

### Cut a release

```bash
git checkout dev && git pull
git push origin dev:release
```

Watch the CI run. If green: master is updated, npm has the new version, dev has the bump commit (or a warning if it didn't fast-forward).

### Cut a release from a hotfix branch

```bash
git push origin hotfix/x:release
```

Action treats it the same as a dev push. Bump lands on master + dev. The hotfix branch isn't back-merged automatically — that's the author's job.

### Re-run a failed release

If CI failed on validation: fix on dev, merge dev → release, push.

If publish failed mid-way (some packages published, some not): re-run the publish job. Already-published packages skip; remaining ones publish. Same target version because the bump commit is already on master.

### Roll back a bad release

You can't unpublish from npm reliably — assume any tagged version is permanent. To undo:
1. Cut a new release with the fix.
2. If needed, deprecate the bad version: `npm deprecate @grest-ts/<pkg>@0.0.31 "bad release, use 0.0.32"`.

## Failure recovery

| Symptom | Cause | Recovery |
|---|---|---|
| CI red on release branch | Tests/typecheck/check failed | Fix on dev → merge dev → release |
| CI green but bump push to master rejected | Release branch isn't descendant of master | `git push origin release:master` from local after auditing diff. Investigate why release diverged. |
| Publish step partial failure | Network blip / rate limit / one package's publish 500'd | Re-run publish job; idempotent |
| Dev didn't get the bump commit (warning in CI logs) | Dev moved during CI run | Next dev → release merge picks up the divergence; version-resolution handles it. Or manually `git fetch origin master && git merge --ff-only origin/master` on dev if you want it caught up immediately. |
| Two pushes to release in quick succession | Concurrency group serializes them | Second one runs after first completes. No action needed. |

## Design notes

A few decisions worth keeping in mind if you change this later.

### Why three branches, not two

Earlier the project had `dev` + `master`, with merge-to-master triggering release. That made master double as both "release trigger" and "last released" — and master would temporarily contain a pre-bump commit until the action caught up. If validation failed mid-flight, master was stuck broken. Splitting trigger (`release`) from result (`master`) gives master a clean invariant: it only moves on green.

### Why the bump commit happens during the action, not before

Earlier flow had humans run version-bump locally before pushing. That couples "do I want to release" with "what version is this" — two decisions made too early. With the action owning the bump, the human gesture is just `dev → release` and version is a side-effect of green.

### Why `git add -A` (permissive mode)

`npm run check` regenerates files (subpackage.jsons, dependency graph, AI rules, dedup checks) when source state demands it. Earlier flow only committed `package.json`s and discarded the rest, which left released artifacts inconsistent with source if a dev forgot to regen before merging. Permissive mode (capture everything) makes "did the dev remember to regen" not a release-blocker — the action does it.

### Why silent backmerge to dev

Dev can move during the 3–5 minute CI run. Trying to FF-push the bump to dev would fail in that window. Three options were on the table:
- Open a PR — re-introduces a manual step.
- Force-push dev — destroys parallel work, never.
- Silent fail with warning — version-resolution on the next release handles divergence.

Option 3 was the choice: the next release computes target as `max(rc package.json, npm-registry-latest) + patch` (well, currently it just `+1`s package.json — see "open items"), so a missed backmerge doesn't republish a stale version. Manual sync (`git fetch origin master && git merge --ff-only`) is always available if you want to reconcile.

### Why the publish workflow checks out master, not workflow_run.head_sha

The bump commit lives on master. `workflow_run.head_sha` points at the release-branch tip — pre-bump. Building from pre-bump would publish the old (already-published) version, which would be a no-op via the publish-helpers skip logic but would also tag a release with no actual publish behind it. Checking out master directly is cleaner.

## Open items / known limitations

- **Version bump doesn't consult the npm registry.** `grest.3.ver.patch.ts` only patches `package.json`. If someone manually bumps `package.json` past the registry's latest (or the silent-backmerge-to-dev fails repeatedly), the bump can desync from registry state. The intended behavior is `target = max(package.json, registry-latest) + patch` (or just `package.json` if it's already greater). Worth wiring up once we hit a case where it matters.
- **No release notes / changelog.** Tag message is just `v0.0.x`. Could shell out to `git log --pretty` between tags into a CHANGELOG.md if/when releases get visible enough that humans want a summary.
- **No "next" / pre-release channel.** All releases go to `latest` dist-tag. If we want canary releases, add a `release-next` branch with a parallel workflow that publishes to `next`.
- **No rollback automation.** Documented manually above. Probably won't bother with automation unless we have a real scare.
