# grest-ts packaging hardening

Notes from a kratt deploy where two copies of `@grest-ts/config` ended up
in memory at runtime. Symptom: `Error: No prefix defined in context`
inside `GGConfig.define()` callbacks — the bundled copy set the prefix on
its `AsyncLocalStorage`, the node_modules copy read from a different one.

The hub-server bundle had `@grest-ts/config` in `devDependencies`
(bundled into the output) and `@grest-ts/db-dynamodb` / `@grest-ts/api-docs`
in `dependencies` (external). The external packages each pulled their own
`@grest-ts/config` from `node_modules`, separate from the bundled copy.

Workaround: move `@grest-ts/config` to `dependencies` so esbuild marks
every import of it external — single copy in `node_modules`, single ALS.

Below: framework-side changes that would prevent the class of bug
without requiring careful per-project packaging.

## 1. Make module-scoped state instance-independent (highest impact)

`AsyncLocalStorage` is the load-bearing singleton. If two module copies
load, you get two ALSs and context set on one is invisible from the
other. Move the ALS to a `globalThis` slot keyed by `Symbol.for(...)`:

```ts
const ALS_KEY = Symbol.for("@grest-ts/config:creation-context");
const als: AsyncLocalStorage<Ctx> =
    (globalThis as any)[ALS_KEY] ??=
    new AsyncLocalStorage<Ctx>();
```

`Symbol.for` lives in the cross-realm registry, so two physically
distinct copies of the module share one ALS. Module duplication still
happens in memory — but the behavior becomes correct: `define()` in
copy A is observable from `getCreationContext()` in copy B.

Same pattern for any other module-scoped singletons in grest-ts:

- logger registries
- locator state
- discovery registries
- the runtime singleton

This is what React, styled-components, and other libraries do to survive
duplicate loads. Ten lines of code per singleton; eliminates the entire
class of "two copies, broken context" failure forever.

## 2. Don't bake asset paths into `import.meta.url`

`@grest-ts/api-docs` resolves its `dist-ui/` directory by walking up from
`import.meta.url`. When the package is bundled, `import.meta.url` points
to the bundle and the relative walk lands somewhere wrong. The fix is
two changes either of which works:

- **Accept the path as an option:** `GGApiDocs.register({distUiPath?: string})`,
  defaulting to the current `import.meta.url`-based resolution. Projects
  that bundle can pass the path explicitly.
- **Inline assets at build time:** Vite/esbuild can embed the dist-ui
  files as base64 strings inside the JS bundle. Then the runtime needs
  no filesystem at all — works identically external or bundled.

Inlining is bundler-proof and removes a class of "where did the assets
go" bugs. The trade-off is bundle size, but `dist-ui` is small.

## 3. Fail-fast detection of duplicate loads

In `@grest-ts/config` top-level code:

```ts
const FLAG = Symbol.for("@grest-ts/config:loaded");
if ((globalThis as any)[FLAG]) {
    console.warn(
        "[@grest-ts/config] loaded multiple times. " +
        "Bundler is producing two copies — check that the package is " +
        "external in your bundler config, or that all @grest-ts/* " +
        "dependencies route to a single resolution."
    );
}
(globalThis as any)[FLAG] = true;
```

Doesn't fix anything, but turns a 30-minute stack-trace dive into a
single warning at startup. Pairs well with (1): even if (1) makes
duplicates harmless, the warning still flags wasted memory and signals
a packaging mistake worth correcting.

## 4. Ship a bundler helper

A tiny `@grest-ts/esbuild-plugin` (and equivalents for Vite, Rollup,
Webpack) that auto-externalizes anything matching `^@grest-ts/`:

```ts
import {externalizeGrest} from "@grest-ts/esbuild-plugin";

esbuild.build({
    ...,
    plugins: [externalizeGrest()],
});
```

Removes the per-project decision and the per-project `dependencies` vs
`devDependencies` micro-management. Documentation can then be: "use the
plugin, put `@grest-ts/*` packages anywhere — the plugin handles it."

## On tree-shaking and barrel exports (rejected approaches)

Tree-shaking does not deduplicate. It removes unused exports from a
single module copy; it doesn't merge two physical copies. Even if a
project tree-shakes `@grest-ts/config` down to just `GGConfig`, two
copies still produce two `AsyncLocalStorage` instances.

A single barrel package (`@grest-ts` re-exporting everything) doesn't
fix the problem either — npm and pnpm can still install two copies of
the barrel when transitive version constraints diverge, and the surface
area becomes painful to evolve. Better to keep the package boundaries
the way they are and harden each package via (1).

## Priority

If only one thing gets done, **(1)** — globalThis-scoped singletons.
That single change makes grest-ts robust against:

- bundlers that bundle some packages and not others
- npm hoisting quirks
- pnpm strict isolation
- multiple major versions in the same dependency tree
- any future packaging weirdness

Everything else (asset paths, warnings, build plugins) is polish on top.
