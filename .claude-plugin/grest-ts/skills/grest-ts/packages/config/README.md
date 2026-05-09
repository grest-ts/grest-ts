<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/config

Type-safe configuration management for Grest Framework.

## Features

- Type-safe configuration keys with validation
- Multiple key types (Settings, Secrets, Resources)
- Pluggable storage backends (file, environment, remote)
- Runtime configuration updates with watchers
- Centralized configuration definitions
- Config values are validated!

## Pattern

- Keys are defined statically, but values are resolved at runtime from async context
- Different key types (Setting, Secret, Resource) can use different storage backends (Strategy pattern)
- Supports watching for runtime configuration changes (Observer pattern)

## Getting Started

### 1. Define your configuration

```typescript
import {GGConfig, GGSetting, GGSecret, GGResource} from "@grest-ts/config"
import {IsString, IsPosInt, IsBoolean} from "@grest-ts/schema"

export const AppConfig = GGConfig.define('/app/', () => ({
    server: {
        port: new GGSetting('server/port', IsPosInt, 3000, 'HTTP server port'),
        debug: new GGSetting('debug', IsBoolean, false, 'Enable debug mode'),
    },
    database: {
        host: new GGResource('db/host', IsString, 'Database host'),
        password: new GGSecret('db/password', IsString, 'Database password'),
    }
}));
```

### 2. Provide local values for development

```typescript
import {createLocalConfig} from "@grest-ts/config"

export const localConfig = createLocalConfig(AppConfig, {
    database: {
        host: "localhost:5432",
        password: "root"
    }
});
```

`createLocalConfig` is a compile-time helper — it type-checks the values against your config definition.

### 3. Wire it up in your runtime

```typescript
import {GGConfigLocator, GGConfigStoreFile} from "@grest-ts/config"

new GGConfigLocator(AppConfig, localConfig)
    .add(GGSetting, new GGConfigStoreFile('./config/settings.json', import.meta.url))
    .add([GGSecret, GGResource], new GGConfigStoreAwsSecretsManager({ ... }))
```

When `localConfig` is passed to the constructor, stores are automatically swapped for `GGConfigStoreLocal` outside of production — so your real stores (AWS, files, etc.) are only used when `NODE_ENV=production`.

### 4. Use it

```typescript
// Settings - .get()
const port = AppConfig.server.port.get();
const debug = AppConfig.server.debug.get();

// Secrets - .reveal() to make intent explicit
const dbPassword = AppConfig.database.password.reveal();

// Resources - .get()
const dbHost = AppConfig.database.host.get();

// Watch for runtime changes
const unwatch = AppConfig.server.port.watch((newPort) => {
    console.log('Port changed to:', newPort);
});
unwatch(); // stop watching
```

## Key Types

| Type           | Constructor                          | Read method | Use Case                             |
|----------------|--------------------------------------|-------------|--------------------------------------|
| **GGSetting**  | `(name, schema, default, description)` | `.get()`    | General configuration (ports, flags) |
| **GGSecret**   | `(name, schema, description)`          | `.reveal()` | Sensitive data (API keys, passwords) |
| **GGResource** | `(name, schema, description)`          | `.get()`    | Infrastructure (URLs, hosts, paths)  |

Settings have a default value. Secrets and resources do not — their values must come from a store.

## Validation

All keys require a `@grest-ts/schema` validator. Values are validated when loaded from a store.
Invalid config at startup prevents the service from starting. Invalid config during a runtime reload is rejected and an error is raised — the previous valid value remains in effect.

```typescript
import {IsString, IsPosInt, IsBoolean, IsLiteral} from "@grest-ts/schema"

port: new GGSetting('port', IsPosInt, 8080, 'Server port')
name: new GGSetting('name', IsString, 'default', 'App name')
env:  new GGSetting('env', IsLiteral('dev', 'staging', 'prod'), 'dev', 'Environment')
```

## Storage Backends

`GGConfigLocator` maps key types to stores. Each key type must have a store registered before start.

```typescript
new GGConfigLocator(AppConfig)
    .add(GGSetting, new GGConfigStoreFile("./config/settings.json", import.meta.url))
    .add(GGResource, new GGConfigStoreFile("./config/resources.json", import.meta.url))
```

Multiple key types can share a store:

```typescript
new GGConfigLocator(AppConfig)
    .add([GGSetting, GGResource], new GGConfigStoreFile("./config/config.json", import.meta.url))
```

### GGConfigStoreFile

Reads values from a JSON file. Watches the file for changes and automatically reloads (100ms debounce).

The key path `/app/server/port` maps to `app.server.port` in JSON:

```json
{
    "app": {
        "server": {
            "port": 8080
        },
        "debug": true
    }
}
```

### GGConfigStoreLocal

Type-safe development store. Refuses to start when `NODE_ENV=production`.

```typescript
import {createLocalConfig, GGConfigStoreLocal} from "@grest-ts/config"

const localConfig = createLocalConfig(AppConfig, {
    database: {
        host: "localhost:5432",
        password: "root"
    }
});

new GGConfigLocator(AppConfig)
    .add([GGResource, GGSecret], new GGConfigStoreLocal(AppConfig, localConfig))
    .add(GGSetting, new GGConfigStoreFile('./config/settings.json', import.meta.url))
```

### GGConfigStoreAwsSecretsManager

See [@grest-ts/config-aws](../config-aws/README.md).

## Testing

Config is automatically restored between tests — no manual cleanup needed. When a test modifies config via `t.config.update()`, the testkit records which keys were changed and reverts them after the test completes.

```typescript
describe("my tests", () => {
    const t = GGTest.startWorker(MyRuntime);

    test('modify config for this test', async () => {
        await t.config.update(AppConfig.server.port, 9999);
        // ... test with modified config
    });

    test('next test sees original config', async () => {
        const port = await t.config.get(AppConfig.server.port);
        expect(port).toBe(3000); // automatically restored
    });
});
```

Config set in `beforeAll` or by framework hooks (e.g. `GGTest.with().clone()`) is preserved — only changes made during individual tests are reverted. This also works with nested `describe` blocks: each scope's `beforeAll` overrides are reverted in its `afterAll`, so sibling describes don't see each other's config.

## Further Reading

- [Extending](./README-extending.md) - How to add custom key types and stores
