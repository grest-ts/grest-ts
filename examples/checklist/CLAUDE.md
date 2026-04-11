# Project context — checklist example

This is a **grest-ts** multi-service example (single npm package, multiple runtimes in one repo).
Framework docs: https://github.com/grest-ts/grest-ts

## Layout

```
common/             — shared API contracts and event definitions
  api-user/         ← public-facing API contracts
  api-user-public/  ← unauthenticated API contracts
  api-internal/     ← internal service-to-service contracts
  events/           ← typed event definitions

checklist/          — Checklist runtime (main service)
  checklist.ts      ← runtime entry point
  schema/           ← domain schemas
  services/         ← API implementations (ChecklistService, UserService, …)
  config/           ← local config overrides
  test/             ← integration tests
  UserContext.ts    ← GGContextKey for per-request auth

blocker/            — Blocker runtime (secondary service)
  blocker.ts        ← runtime entry point
  schema/           ← domain schemas
  services/         ← API implementations
  config/           ← local config overrides

shared/             — shared runtime helpers (MyRuntime base class)
```

## Key conventions

- Contracts are in `common/` — imported by both runtimes.
- Each runtime has its own entry point (`checklist.ts`, `blocker.ts`).
- All wiring is in each runtime's `compose()` — no DI, plain constructors.
- Integration tests use `GGTest.startWorker([ChecklistRuntime, BlockerRuntime])` for cross-service tests.
- `@mockable` services: `AddressResolverService`, `NotificationService` — mock with `mockOf()` in tests.
- Run checklist: `npm run checklist`
- Run blocker: `npm run blocker`
- Run tests: `npm test`
