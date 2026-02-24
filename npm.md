# Plan: Add build step for npm publishing

## Context

Packages currently ship raw `.ts` source to npm, which is non-standard. We need a build step that compiles to `.js` + `.d.ts` + `.d.ts.map`, while also shipping original `.ts` source so that ctrl+click in consumers' IDEs navigates to real source code (via `declarationMap`). The existing tsconfig setup (`noEmit: true`) must not be touched — it's optimized for development.

## Approach

1. **x-packager generates `tsconfig.publish.json`** per publishable package (alongside existing tsconfigs)
2. **npm publish script** runs validation -> build -> rewrite package.json -> publish -> restore + cleanup

## Changes

### 1. `x-packager/src/code/GGTsConfigBuilder.ts` — add `buildPublishConfig()`

In `buildPackageConfigs()`, after the existing config generation (~line 92), add:
```typescript
if (pkg.config.publishToNpm) {
    files.push(this.buildPublishConfig(pkg))
}
```

New method `buildPublishConfig(pkg)` generates `tsconfig.publish.json` at the package root:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "./dist",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "noEmit": false,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*", "testkit/**/*"],
  "exclude": ["**/*.test.ts", "**/*.spec.ts"]
}
```

- `rootDir: "."` so `src/foo.ts` -> `dist/src/foo.js` and `testkit/bar.ts` -> `dist/testkit/bar.js`
- `include` adds `testkit/**/*` and `codegen/**/*` only when the package has those extensions
- `lib`/`types` use the union of what src/ and testkit/ need (browser-aware lib, node types)
- Does NOT include `vitest/globals` in types — published code shouldn't depend on vitest
- Uses `buildExtendsPath(pkg.depth)` (no extra level — file is at package root, not in src/)

### 2. `grest.npm.publish.ts` — full rework

**Pipeline:**
1. Run `tsx grest.check.ts` (config generation + typecheck + example typecheck)
2. Run `vitest run` (all tests)
3. Discover publishable packages, check which versions need publishing (skip already-published)
4. Build each: clean `dist/`, run `tsc -p tsconfig.publish.json`
5. Rewrite each `package.json`: exports point to `dist/` paths, `files` includes `["dist", "src", ...]`
6. Publish each sequentially with `npm publish --access public`
7. **Always** restore original `package.json` files and clean `dist/` folders (in `finally` block)

**Export rewriting logic** (inline in publish script):
- `./src/index-node.ts` -> types: `./dist/src/index-node.d.ts`, import: `./dist/src/index-node.js`
- `./testkit/index-testkit.ts` -> types: `./dist/testkit/index-testkit.d.ts`, import: `./dist/testkit/index-testkit.js`
- Handles both conditional exports (browser/default) and flat exports

**Example — before rewrite (development package.json for `@grest-ts/http`):**
```json
{
  "exports": {
    ".": {
      "browser": { "types": "./src/index-browser.ts", "import": "./src/index-browser.ts" },
      "default": { "types": "./src/index-node.ts", "import": "./src/index-node.ts" }
    },
    "./testkit": { "types": "./testkit/index-testkit.ts", "import": "./testkit/index-testkit.ts" }
  },
  "files": ["src", "testkit"]
}
```

**Example — after rewrite (temporary, for npm publish only):**
```json
{
  "exports": {
    ".": {
      "browser": { "types": "./dist/src/index-browser.d.ts", "import": "./dist/src/index-browser.js" },
      "default": { "types": "./dist/src/index-node.d.ts", "import": "./dist/src/index-node.js" }
    },
    "./testkit": { "types": "./dist/testkit/index-testkit.d.ts", "import": "./dist/testkit/index-testkit.js" }
  },
  "files": ["dist", "src", "testkit"]
}
```

**Flags:** `--dry-run` (preview only), `--skip-validation` (skip check + tests for faster iteration)

### 3. Published package structure (e.g., `@grest-ts/http`)

```
package.json         (exports -> dist/)
dist/
  src/
    index-node.js / .d.ts / .d.ts.map
    index-browser.js / .d.ts / .d.ts.map
  testkit/
    index-testkit.js / .d.ts / .d.ts.map
src/                 (original source — for declarationMap ctrl+click)
  index-node.ts
  index-browser.ts
testkit/             (original source)
  index-testkit.ts
```

The `.d.ts.map` files reference `../../src/index-node.ts` — since `src/` is in the tarball alongside `dist/`, ctrl+click resolves to the real `.ts` source.

## What does NOT change

- `tsconfig.base.json` — untouched, `noEmit: true` stays
- `GGPackageBuilder.ts` — no changes, package.json generation stays the same
- Per-package `src/tsconfig.json`, `test/tsconfig.json`, `testkit/tsconfig.json` — untouched
- `.gitignore` — already has `**/dist/`
- `grest.package.ts` files — `publishToNpm: true` already marks packages
- `grest.check.ts` — called by publish script, not modified

## Verification

1. Run `npm run generate` -> verify `tsconfig.publish.json` appears in publishable packages
2. Run `npx tsc -p tsconfig.publish.json` in `packages/common` -> inspect `dist/src/` output
3. Verify `dist/src/index-node.d.ts.map` has valid source path to `../../src/index-node.ts`
4. Run `tsx grest.npm.publish.ts --dry-run` -> verify discovery and rewrite preview
5. Optionally publish to local Verdaccio first to test end-to-end
