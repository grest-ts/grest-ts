# Plan: Convert x-packager from workspace package to `scripts/`

## Problem

`x-packager` is a build-time code generation tool — it generates `package.json`, `tsconfig.json`, `vitest.config.ts`, and dependency docs for all ~40 packages. It is **not published to npm**, yet it's structured as a workspace package with its own `package.json`, `grest.package.ts`, `tsconfig.json`, `bin/`, etc.

This is unconventional. Most monorepos (React, Babel, Jest, Prettier) keep internal build tooling in a `scripts/` or `tools/` directory — just plain files, not packages.

## Target state

```
scripts/
  packager/              ← was x-packager/src/
    index.ts             ← was index-node.ts
    definePackage.ts
    publish-helpers.ts   ← was x-packager/src/publish-helpers.ts
    code/
      GGPackager.ts
      GGParser.ts
      GGPackageBuilder.ts
      GGTsConfigBuilder.ts
      GGVitestConfigBuilder.ts
      ... (all other code/ files)
```

No `package.json`. No `grest.package.ts`. No `bin/`. No workspace entry.

## Import resolution

All 41 `grest.package.ts` files currently import:
```typescript
import {definePackage} from "@grest-ts/x-packager"
```

This resolves because x-packager is a workspace package. After the move, we need a different resolution mechanism.

**Approach: Node subpath imports (`#imports`)**

Add to root `package.json`:
```json
{
  "imports": {
    "#scripts/*": "./scripts/*"
  }
}
```

Add to `tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "paths": {
      "#scripts/*": ["./scripts/*"]
    }
  }
}
```

All `grest.package.ts` files become:
```typescript
import {definePackage} from "#scripts/packager/definePackage.ts"
```

Node subpath imports (`#`-prefixed) are a stable Node.js feature, supported natively by tsx. The tsconfig `paths` entry lets `tsc --noEmit` resolve the types.

## Steps

### 1. Create `scripts/packager/` and move source files

- `x-packager/src/code/*` → `scripts/packager/code/*`
- `x-packager/src/definePackage.ts` → `scripts/packager/definePackage.ts`
- `x-packager/src/index-node.ts` → `scripts/packager/index.ts`
- `x-packager/src/publish-helpers.ts` → `scripts/packager/publish-helpers.ts`

Use `git mv` to preserve history.

### 2. Add `#scripts/*` import mapping

**Root `package.json`** — add `imports` field:
```json
"imports": {
  "#scripts/*": "./scripts/*"
}
```

**`tsconfig.base.json`** — add `paths`:
```json
"paths": {
  "#scripts/*": ["./scripts/*"]
}
```

### 3. Update all `grest.package.ts` imports (41 files)

Change every:
```typescript
import {definePackage} from "@grest-ts/x-packager"
```
to:
```typescript
import {definePackage} from "#scripts/packager/definePackage.ts"
```

This is a simple find-and-replace across all `grest.package.ts` files.

### 4. Update root entry scripts

**`grest.x-packager.ts`**:
```typescript
import {definePackage} from "#scripts/packager/definePackage.ts"
```

Also remove `"x-packager"` from the `packages` array since it's no longer a package directory to scan.

**`grest.5.npm.publish.ts`** and **`grest.5.verdaccio.publish.ts`**:
```typescript
// from:
import {...} from "./x-packager/src/publish-helpers"
// to:
import {...} from "#scripts/packager/publish-helpers.ts"
```

### 5. Move `fast-glob` to root `devDependencies`

x-packager's only dependency is `fast-glob`. Move it to root `devDependencies` since it's used by build scripts.

### 6. Update root `tsconfig.json` includes

The generated root tsconfig currently has `"x-packager/src/**/*"` in its includes. The packager needs to update this to `"scripts/**/*"` instead. This means updating the `GGPackager` code that generates the root tsconfig to include `scripts/` as a static entry (similar to how it handles `exports/`).

### 7. Delete `x-packager/` directory

Remove entirely:
- `x-packager/package.json`
- `x-packager/grest.package.ts` (self-referential config, no longer needed)
- `x-packager/tsconfig.json`
- `x-packager/tsconfig.publish.json`
- `x-packager/bin/grest-packager.mjs` (unused CLI — `npm run generate` is the actual entry point)
- `x-packager/README.md`
- `x-packager/LICENSE`

### 8. Update packager self-references

Inside the packager code itself, some files may reference `x-packager` in paths or patterns. Audit and update:
- `GGParser.ts` — package discovery logic (should skip `scripts/`)
- `GGPackager.ts` — root tsconfig generation (include `scripts/**/*`)
- `definePackage.ts` — the `process.argv` check that auto-runs when file ends with `grest.package.ts` or `grest.x-packager.ts`

### 9. Run `npm install` to remove x-packager workspace

### 10. Run `npm run generate` and verify

- All `package.json` files regenerate correctly
- All `tsconfig.json` files regenerate correctly
- `x-packager` no longer appears in workspace list
- `npm run typecheck` passes

## Files to modify

| File | Change |
|------|--------|
| `scripts/packager/**` | **Create** — moved from `x-packager/src/` |
| `package.json` (root) | Add `imports` field, move `fast-glob` to devDeps |
| `tsconfig.base.json` | Add `paths` for `#scripts/*` |
| `grest.x-packager.ts` | Update import, remove `x-packager` from packages |
| `grest.5.npm.publish.ts` | Update import path |
| `grest.5.verdaccio.publish.ts` | Update import path |
| 41x `grest.package.ts` | Update import path |
| `x-packager/` | **Delete entirely** |

## What stays the same

- The `definePackage()` API — no changes to how packages define themselves
- The `grest.package.ts` convention — every package still has one
- `npm run generate` — still works exactly the same way
- All generated outputs — identical results
