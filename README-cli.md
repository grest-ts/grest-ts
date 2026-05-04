# CLI

Two things you'll actually do: start a new project, and bump grest-ts to a newer version.

## Start a new project

```bash
npm create @grest-ts/starter my-app
```

You get an npm workspaces monorepo with three packages:

- **api/** — shared contract definitions (used by server and client)
- **server/** — backend implementation with integration tests
- **client/** — frontend (Vite + TypeScript)

Run it with two terminals:

```bash
cd my-app/server && npm run dev
cd my-app/client && npm run dev
```

In case this structure is not quite what you want, you can ask AI to restructure it to your needs.

## Update grest-ts

```bash
npx @grest-ts/cli update
```

That bumps every `@grest-ts/*` package in your project to the latest published version, atomically. Don't edit `@grest-ts/*` versions in `package.json` by hand — versions only move via `update`.

### Variants

```bash
npx @grest-ts/cli update 0.0.30      # specific version
npx @grest-ts/cli update next        # dist-tag (latest, next, …)
npx @grest-ts/cli update --dry-run   # preview only
```

### What `update` does

1. Scans every `package.json` in your project (root + npm workspaces) for `@grest-ts/*` deps.
2. Resolves the target version (concrete or dist-tag).
3. Verifies every required package is published at that version. Fails before touching files if anything is missing.
4. Adds any `@grest-ts/*` peers your packages need that you don't already have, with a summary of what was added:

   ```
   Adding 2 missing peer(s) to package.json:
     + @grest-ts/locator
     + @grest-ts/context
   ```

5. Pins every `@grest-ts/*` entry to the exact target version.
6. Deletes the lockfile and `node_modules/@grest-ts/`, then runs `npm install`.
