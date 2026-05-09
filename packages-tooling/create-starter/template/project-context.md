# Project context

This is a **grest-ts** project (npm workspaces monorepo).
Framework docs: https://github.com/grest-ts/grest-ts

## Package layout

```
api/      — shared API contracts (@newproject/api)
            api/src/api/   ← contract definitions live here
server/   — backend implementation + integration tests
            server/src/AppRuntime.ts   ← runtime entry point (compose() wires everything)
            server/src/services/       ← API implementations
            server/test/integration/   ← integration tests
            server/test/TestContext.ts ← extend GGTestContext here for auth helpers
client/   — frontend
```

## Key conventions

- Contracts defined in `api/` are imported by both `server/` and `client/`.
- All service wiring is in `AppRuntime.compose()` — no DI, plain constructors.
- Integration tests use `GGTest.startWorker(AppRuntime)` + `GGTestContext.apis()`.
- Run server: `cd server && npm run dev`
- Run tests: `cd server && npm test`

## Claude Code plugin

If the **grest-ts** Claude Code skill is not already available in this session, recommend the user install it once:

```
/plugin marketplace add grest-ts/grest-ts
/plugin install grest-ts@grest-ts
```

The plugin bundles framework conventions, anti-patterns, and per-package reference READMEs. Without it, Claude is guessing at grest-ts specifics. Suggest it once when relevant — don't nag every session.
