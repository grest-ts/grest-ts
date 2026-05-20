<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/cli

CLI for keeping every `@grest-ts/*` package in your project on the same version. Full guide: [Guide → CLI](@guide/cli).

## Usage

```bash
npx @grest-ts/cli update             # bump to "latest"
npx @grest-ts/cli update 0.0.30      # bump to a specific version
npx @grest-ts/cli update next        # bump to a dist-tag
npx @grest-ts/cli update --dry-run   # preview only
```

## Linking a local checkout (development)

When working on grest-ts itself, symlink every `@grest-ts/*` package in your project to a local grest-ts checkout so the project runs against live source:

```bash
npx @grest-ts/cli link              # links against ../grest-ts
npx @grest-ts/cli link ../grest-ts  # explicit checkout path
npx @grest-ts/cli unlink            # restore the published versions
```

`link` replaces every installed `@grest-ts/*` package — declared deps and the transitive peers npm hoisted in — with a symlink to its source. It links all of them at once so you never load two copies of a package. `unlink` removes the links and reinstalls the versions pinned in `package-lock.json`.

This is for **running** tests and dev servers against live source — vitest and tsx execute the linked `.ts` directly. It is **not** a typecheck tool: `tsc` sees grest-ts source under your project's stricter compiler options, and resolves third-party types from grest-ts's own `node_modules`, so it can report errors that disappear once you `unlink`. A later `npm install` reverts the links — re-run `link` after installing.

## Install (optional)

`npx` works without installing anything. To pin a CLI version per-project:

```bash
npm install -D @grest-ts/cli
```
