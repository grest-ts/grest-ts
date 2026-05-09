<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/create-starter

Scaffold a new grest-ts project with a single command.

## Quick Start

```bash
npx @grest-ts/create-starter my-app
```

Or run without arguments to be prompted for a project name:

```bash
npx @grest-ts/create-starter
```

Then follow the printed instructions:

```bash
cd my-app
npm install
cd server && npm run dev      # start the server
cd client && npm run dev      # start the client (in another terminal)
```

The server starts on `http://localhost:9000` and the client on `http://localhost:3000`.

## What You Get

The generated project is a npm workspaces monorepo with three packages:

```
my-app/
├── api/            # Shared contracts and types
│   └── src/api/
│       └── HelloApi.ts
├── server/         # Backend HTTP server
│   ├── src/
│   │   ├── AppRuntime.ts
│   │   └── services/
│   │       └── HelloApiImpl.ts
│   └── test/
│       ├── integration/
│       │   └── hello.test.ts
│       └── TestContext.ts
├── client/         # Frontend web UI (Vite)
│   ├── index.html
│   └── src/
│       └── main.ts
└── package.json
```

### `api/` — Shared Contracts

Defines typed API contracts using `@grest-ts/schema` and `@grest-ts/http`. Contracts are shared between the server and client so both sides stay in sync.

### `server/` — Backend

A grest-ts runtime that serves the API over HTTP. Comes with:

- A working `HelloApi` implementation
- Integration tests using Vitest and `@grest-ts/testkit`
- esbuild bundling for production
- Watch mode for development (`npm run dev`)

### `client/` — Frontend

A Vite-powered web UI with a typed API client generated from the shared contract. The dev server proxies `/api/*` requests to the backend.

## Requirements

- Node.js >= 25

## License

MIT
