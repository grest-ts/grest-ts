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
