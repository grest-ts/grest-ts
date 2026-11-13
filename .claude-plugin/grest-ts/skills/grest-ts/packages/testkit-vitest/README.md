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

- Every runtime of a `GGTest.startWorker({...})` starts at the same time: each spends its boot loading its own module
  graph. A runtime must not call a peer from its own `start()`; call it lazily, when a request needs it.
- Vitest's `isolate: false` works: the setup file re-runs for every test file in a worker without stacking wrappers.
  The test process's module state (fixtures, module-level singletons, anything a test file sets globally) is then
  shared between the files of a worker. A test file that replaces something global (`GGSocketPool.setAdapter`, a
  module-level registry) must restore it in `afterAll`.
- Under `isolate: false` runtime worker threads are reused too: when a file's runtime stops, its worker keeps its loaded
  modules and the next file's start of the same runtime constructs and starts a fresh instance in it, skipping the
  module loading that is most of a runtime's boot. Instance state is fresh per file; module-level state in the runtime's
  code (a module-level cache, a `.define()` run in `compose()`) is shared between files, so keep state on the instances
  `compose()` creates. A worker no runtime of the next file uses is ended.
