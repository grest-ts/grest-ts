<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/testkit-vitest

Vitest integration for `@grest-ts/testkit`. This package is configured as a global setup script — it wraps Vitest's `describe`, `test`, `beforeAll`, `afterEach`, and other lifecycle hooks so that the testkit infrastructure (service discovery, IPC, test runner) is automatically initialized and torn down for each test suite.

You don't use this package directly. It is set up by `@grest-ts/testkit` and works behind the scenes.

## What it does

- Wraps `describe`/`test`/`it` globally to manage testkit scopes and context
- Starts an IPC server and local discovery for each top-level `describe` block
- Handles `beforeAll`/`afterEach`/`afterAll` cleanup automatically
- Supports nested `describe` blocks with proper scope branching
- Exports a `./globalSetup` entry point for Vitest configuration

## Runtime start and `isolate: false`

- Runtimes start in parallel and `compose()` must be re-entrant; see the testkit README, "Runtime start and worker
  reuse".
- Vitest's `isolate: false` works: the setup file re-runs for every test file in a worker without stacking wrappers.
  The test process's module state (fixtures, module-level singletons, anything a test file sets globally) is then
  shared between the files of a worker. A test file that replaces something global (`GGSocketPool.setAdapter`, a
  module-level registry) must restore it in `afterAll`.
- Under `isolate: false` runtime worker threads are reused too: when a runtime stops, its worker keeps its loaded
  modules and the next start of the same runtime (in a later `describe`, a later file, or a test) constructs and starts
  a fresh instance in it, skipping the module loading that is most of a runtime's boot. A parked worker that nothing
  took by the end of the next `describe` is ended. The `./globalSetup` entry reads `isolate` from the project config
  and provides it to the setup file; without it, workers aren't reused.
