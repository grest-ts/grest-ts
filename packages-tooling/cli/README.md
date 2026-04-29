<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/cli

CLI for managing grest-ts in a project.

## Why

grest-ts is single-version: every `@grest-ts/*` package in a project must be at the same version. Inter-package peer dependencies are pinned exactly, so bumping one package forces bumping all of them — and once a `package-lock.json` is in play, npm's resolver can't reconcile the cross-package pins through a partial update.

This CLI does the bump atomically.

## Usage

Run from your project root (single-package or npm workspaces monorepo):

```bash
npx @grest-ts/cli upgrade            # bumps to "latest" dist-tag
npx @grest-ts/cli upgrade 0.0.27     # bumps to a specific version
npx @grest-ts/cli upgrade next       # bumps to the "next" dist-tag
npx @grest-ts/cli upgrade --dry-run  # preview without writing
```

## What it does

1. Discovers every `package.json` (root + workspaces).
2. Collects every distinct `@grest-ts/*` dep referenced in `dependencies` and `devDependencies`.
3. Resolves the target version (concrete version or dist-tag).
4. Pre-flight: verifies every collected package is published at the target version. Fails fast if any are missing.
5. Rewrites every `@grest-ts/*` entry to `^<target-version>` (canonical form — overwrites any pre-existing range).
6. Deletes `package-lock.json`.
7. Runs `npm install`.
