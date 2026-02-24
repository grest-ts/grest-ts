# Creating Framework Packages

How to create new packages that extend the Grest Framework.

Note: The `@grest-ts/code-generator` package exists but is currently deprecated/unused. See [its DEPRECATED.md](./packages/code-generator/DEPRECATED.md) for details.

## Package Structure

Every package follows this structure:

```
packages/my-package/
├── grest.package.ts          # Package definition
├── src/
│   ├── index-node.ts      # Node.js entry point
│   └── index-browser.ts   # Browser entry point (optional)
├── testkit/
│   └── index-testkit.ts   # Testing utilities (optional)
├── codegen/
│   └── index-codegen.ts   # Code generation (optional)
└── test/                  # Tests (optional)
    └── *.test.ts
```

## Package Definition

Create `grest.package.ts` in your package root:

```typescript
// packages/my-package/grest.package.ts
import {definePackage} from "@grest-ts/x-packager"

definePackage({
    // Required fields
    name: "@grest-ts/my-package",
    description: "Description of what this package does",
    targets: {node: true},

    // Optional: Browser support
    // targets: { node: true, browser: true },

    // Optional: External dependencies (NOT @grest-ts/* packages)
    dependencies: {
        "some-npm-package": "^1.0.0"
    },

    // Optional: Peer dependencies (native modules, etc.)
    peerDependencies: {
        "ws": "^8.18.3"
    },

    // Optional: Dev dependencies
    devDependencies: {
        "@types/some-package": "^1.0.0"
    },

    // Optional: Enable tests
    hasTests: true,
    hasTestsFolder: true,

    // Optional: Extend testkit (adds ./testkit export)
    extendsTestKit: true,

    // Optional: Extend code generator (adds ./codegen export)
    extendsCodeGen: true,
    hasCodegenTests: true,

    // Optional: CLI binaries
    bin: {
        "my-command": "./bin/my-command.js"
    },

    // Optional: Custom exports
    customExports: {
        "./special": "./src/special.ts"
    },

    // Optional: Additional @grest-ts/* references (for string-based imports)
    references: ["http", "validator"]
})
```

## Package Definition Options

### Target Platforms

```typescript
targets: {
    node: true,      // Main export: ./src/index-node.ts
        browser
:
    true,   // Browser export: ./src/index-browser.ts
        vitest
:
    true     // Vitest setup: ./vitest/index-vitest.ts
}
```

### Dependencies

```typescript
// External npm packages (auto-discovered @grest-ts/* imports not needed)
dependencies: {
    "mysql2"
:
    "^3.0.0",
        "pg"
:
    "^8.0.0"
}

// Optional native modules
peerDependencies: {
    "ws"
:
    "^8.18.3"
}

// Dev-only dependencies
devDependencies: {
    "@types/pg"
:
    "^8.0.0"
}
```

### Extending Framework Systems

```typescript
// Add ./testkit export for testing utilities
extendsTestKit: true

// Add ./codegen export for code generation
extendsCodeGen: true
hasCodegenTests: true  // If codegen has tests
```

## Entry Points

### Node Entry Point

```typescript
// src/index-node.ts
export * from "./MyClass"
export * from "./types"
export type {MyOptions} from "./options"
```

### Browser Entry Point

```typescript
// src/index-browser.ts
// Subset of exports that work in browser
export * from "./MyClientClass"
export * from "./types"
```

### Testkit Entry Point

```typescript
// testkit/index-testkit.ts
export * from "./mocks"
export * from "./helpers"
```

### Codegen Entry Point

```typescript
// codegen/index-codegen.ts
export * from "./MyParser"
export * from "./MyBuilder"
```

## Creating a Resource Package

Example: Creating a new database adapter

```typescript
// packages/db-redis/grest.package.ts
import {definePackage} from "@grest-ts/x-packager"

definePackage({
    name: "@grest-ts/db-redis",
    description: "Redis database utilities for Grest Framework",
    targets: {node: true},
    extendsTestKit: true,
    dependencies: {
        "ioredis": "^5.0.0"
    }
})
```

```typescript
// packages/db-redis/src/index-node.ts
export {GGRedis} from "./GGRedis"
export {GGRedisConfig} from "./GGRedisConfig"
export type {GGRedisConnection} from "./types"
```

```typescript
// packages/db-redis/src/GGRedisConfig.ts
import {GGResource} from "@grest-ts/config"

export interface GGRedisOptions {
    host: string
    port: number
    password?: string
    db?: number
}

export class GGRedisConfig extends GGResource {
    constructor(
        key: string,
        private options: GGRedisOptions
    ) {
        super(key)
    }

    newRedisPool(): GGRedis {
        return new GGRedis(this.options)
    }
}
```

```typescript
// packages/db-redis/src/GGRedis.ts
import Redis from "ioredis"

export class GGRedis {
    private client: Redis

    constructor(options: GGRedisOptions) {
        this.client = new Redis(options)
    }

    async get(key: string): Promise<string | null> {
        return this.client.get(key)
    }

    async set(key: string, value: string, ttl?: number): Promise<void> {
        if (ttl) {
            await this.client.setex(key, ttl, value)
        } else {
            await this.client.set(key, value)
        }
    }

    async close(): Promise<void> {
        await this.client.quit()
    }
}
```

## Creating a Service Package

Example: Creating a caching service

```typescript
// packages/cache/grest.package.ts
import {definePackage} from "@grest-ts/x-packager"

definePackage({
    name: "@grest-ts/cache",
    description: "Caching utilities for Grest Framework",
    targets: {node: true, browser: true},
    extendsTestKit: true
})
```

```typescript
// packages/cache/src/index-node.ts
export {GGCache} from "./GGCache"
export {GGCacheConfig} from "./GGCacheConfig"
export {MemoryCache} from "./adapters/MemoryCache"
export {RedisCache} from "./adapters/RedisCache"
export type {CacheAdapter, CacheOptions} from "./types"
```

```typescript
// packages/cache/src/index-browser.ts
// Browser only gets memory cache
export {GGCache} from "./GGCache"
export {MemoryCache} from "./adapters/MemoryCache"
export type {CacheAdapter, CacheOptions} from "./types"
```

## Building and Testing

### Generate Package Files

```bash
# From framework root
npm run build

# Or run single package
npx tsx packages/my-package/grest.package.ts
```

This generates:

- `package.json` - NPM package manifest
- `tsconfig.json` - TypeScript configuration

### Run Tests

```bash
# Run all tests
npm test

# Run specific package tests
npm test -- packages/my-package
```

## Dependencies Auto-Discovery

The `@grest-ts/x-packager` automatically discovers:

1. **@grest-ts/* imports** - Scans source files for `@grest-ts/*` imports
2. **TypeScript references** - Sets up tsconfig references
3. **Workspace links** - Configures npm workspace dependencies

You only need to specify:

- External npm packages in `dependencies`
- String-based @grest-ts/* usage in `references`

## Integration with Framework

### Using in Config

```typescript
// In user's config file
import {GGConfig} from "@grest-ts/config"
import {GGRedisConfig} from "@grest-ts/db-redis"

export const MyConfig = GGConfig.define("/my-app/", () => ({
    resources: {
        redis: new GGRedisConfig("cache", {
            host: "localhost",
            port: 6379
        })
    }
}))
```

### Using in Runtime

```typescript
// In user's runtime
protected
compose()
:
void {
    const redis = MyConfig.resources.redis.newRedisPool()
    const cacheService = new CacheService(redis)
    // ...
}
```

## Best Practices

### Keep Packages Focused

Each package should do one thing well. Prefer multiple small packages over one large package.

### Support Testing

Always add testkit exports with mocks and helpers for users to test code that uses your package.

### Document Public API

Export types explicitly and use JSDoc comments for public APIs.

### Handle Cleanup

If your package manages resources (connections, file handles), provide cleanup methods and integrate with runtime lifecycle.
