# Framework overall documentation

Read ./README.md

Each package has a documentation format.
Some packages have subpackages (like packages/discovery/discovery, packages/discovery/discovery-local and so on.)

* README.md - entry point for documentation with short description & example.
* README-using.md - how to use a package in a service with @grest-ts/runtime
* README-testkit.md - how to test a package in vitest with @grest-ts/testkit
* README-extending.md - how to extend a package (involves extending package itself or creating a new package with code-generation and testkit support.)

## Core Packages

- @grest-ts/runtime: Read ./packages/runtime - Main entry point for a service.
- @grest-ts/schema: Read ./packages/schema/schema/README.md - Type-safe validation, branded types, contract definitions.
- @grest-ts/http: Read ./packages/http/http/README.md - HTTP/WebSocket server and client, for both client<->server and server<->server communication.
- @grest-ts/websocket: Read ./packages/http/websocket - WebSocket server and client (Node.js + browser).
- @grest-ts/config: Read ./packages/config/config/README.md - Configuration library, supporting dynamic configuration with .watch(). All configuration should go through this library.
- @grest-ts/config-aws: Read ./packages/config/config-aws - AWS Secrets Manager adapter for config.
- @grest-ts/context: Read ./packages/context/README.md - Hierarchical async context for per-request state.
- @grest-ts/locator: Read ./packages/locator/README.md - Service locator with lifecycle management.
- @grest-ts/common: Read ./packages/common/README.md - All kinds of utilities.
- @grest-ts/logger: Read ./packages/logger/logger/README.md - Logging library.
- @grest-ts/logger-console: Read ./packages/logger/logger-console - Console logger implementation.

## Observability

- @grest-ts/metrics: Read ./packages/metrics/README.md - Metrics library. All metrics should go through this library.
- @grest-ts/trace: Read ./packages/trace/trace - Distributed tracing.
- @grest-ts/trace-http: Read ./packages/trace/trace-http - HTTP tracing integration.

## Discovery & Communication

- @grest-ts/discovery: Read ./packages/discovery/discovery - Service discovery and load balancing.
- @grest-ts/discovery-local: Read ./packages/discovery/discovery-local - Local development discovery (auto-finds services).
- @grest-ts/discovery-static: Read ./packages/discovery/discovery-static - Static service discovery (fixed URLs/ports via config).
- @grest-ts/ipc: Read ./packages/ipc - Framework internal local communication channel between services (and test runner).

## Database

- @grest-ts/db-mysql: Read ./packages-libs/db/db-mysql - MySQL utilities (thin layer over mysql2).
- @grest-ts/db-postgre: Read ./packages-libs/db/db-postgre - PostgreSQL utilities (thin layer over pg).
- @grest-ts/sql: Read ./packages-libs/sql/README.md - Type-safe SQL query builder.

## Files

- @grest-ts/file: Read ./packages/schema/file - File abstraction.
- @grest-ts/file-http: Read ./packages/http/file-http - HTTP file upload/download codec.

## Testing

- @grest-ts/testkit: Read ./packages-tooling/testkit/testkit/README.md - Integration and component testing — GGTest, mockOf, spyOn.
- @grest-ts/testkit-runtime: Read ./packages-tooling/testkit/testkit-runtime - Runtime support for @mockable decorator.
- @grest-ts/testkit-vitest: Read ./packages-tooling/testkit/testkit-vitest - Vitest integration and global setup.

## Utilities

- @grest-ts/struct: Read ./packages-libs/struct - Binary struct serialization and code generation.

# Framework testing

* To do all kinds of standard checks, cleanup project, generate tsconfig, vitest config, etc files with x-packager - run grest.check.ts
* To run tests, just run vitest on project root.

## Testing strategy

* Packages themselves have unit tests that test package specific functionality.
* Integration tests (and usage examples)
    * examples/grest-test - package specific tests, no database. Each package should create its own test.
    * examples/checklist - simple checklist service, uses real database.
