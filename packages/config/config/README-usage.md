# Config Usage

How to use `@grest-ts/config` in your application.

## Defining Configuration

```typescript
import {GGConfig, GGSetting, GGSecret, GGResource} from "@grest-ts/config"
import {tString, tPosInt, tBoolean} from "@grest-ts/schema"

export const AppConfig = GGConfig.define('/app/', () => ({

    // Settings - general application configuration
    port: new GGSetting('server/port', 3000, 'HTTP server port', tPosInt),
    debug: new GGSetting('debug', false, 'Enable debug mode', tBoolean),

    // Secrets - sensitive values (API keys, passwords)
    apiKey: new GGSecret('external/apiKey', '', 'Third-party API key', tString),
    dbPassword: new GGSecret('db/password', '', 'Database password', tString),

    // Resources - infrastructure configuration
    dbHost: new GGResource('db/host', 'localhost', 'Database host', tString),
    redisUrl: new GGResource('redis/url', 'redis://localhost:6379', 'Redis URL', tString)
}));
```

## Key Types

| Type         | Method      | Use Case                               |
|--------------|-------------|----------------------------------------|
| **GGSetting** | `.get()`    | General configuration (ports, flags)   |
| **GGSecret**  | `.reveal()` | Sensitive data (API keys, passwords)   |
| **GGResource** | `.get()`   | Infrastructure (URLs, hosts, paths)    |

## Reading Values

```typescript
// Settings
const port = AppConfig.port.get();
const debug = AppConfig.debug.get();

// Secrets - use reveal() to make intent clear
const apiKey = AppConfig.apiKey.reveal();

// Resources
const dbHost = AppConfig.dbHost.get();
```

## Validation

All keys require a validator. Values are validated on read:

```typescript
import {tString, tPosInt, tEnum} from "@grest-ts/schema"

// Number validation
port: new GGSetting('port', 8080, 'Server port', tPosInt)

// String validation
name: new GGSetting('name', 'default', 'App name', tString)

// Enum validation
env: new GGSetting('env', 'dev', 'Environment', tEnum(['dev', 'staging', 'prod']))
```

## Watching for Changes

React to configuration changes at runtime:

```typescript
const unwatch = AppConfig.port.watch((newPort) => {
    console.log('Port changed to:', newPort);
    // Restart server, update connections, etc.
});

// Later: stop watching
unwatch();
```

## Storage Backends

Configure where each key type reads values from:

```typescript
import {GGConfigLoader, GGConfigStoreFile} from "@grest-ts/config"
import {GGSetting, GGSecret, GGResource} from "@grest-ts/config"

new GGConfigLoader(new Map([
    [GGSetting, new GGConfigStoreFile('settings.json', import.meta.url)],
    [GGSecret, new GGConfigStoreEnv()],  // Custom: read from environment
    [GGResource, new GGConfigStoreFile('resources.json', import.meta.url)]
]));
```

## File-based Configuration

Example `settings.json`:

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

The key path `/app/server/port` maps to `app.server.port` in JSON.

## Best Practices

### Group Related Configuration

```typescript
export const AppConfig = GGConfig.define('/app/', () => ({
    server: {
        port: new GGSetting('server/port', 3000, 'HTTP port', tPosInt),
        host: new GGSetting('server/host', '0.0.0.0', 'Bind address', tString)
    },
    database: {
        host: new GGResource('db/host', 'localhost', 'DB host', tString),
        password: new GGSecret('db/password', '', 'DB password', tString)
    }
}));

// Access
AppConfig.server.port.get();
AppConfig.database.password.reveal();
```

### Provide Meaningful Defaults

```typescript
// Good - sensible defaults for local development
port: new GGSetting('port', 3000, 'Server port', tPosInt)
dbHost: new GGResource('db/host', 'localhost', 'Database host', tString)

// Good - empty default for required secrets
apiKey: new GGSecret('apiKey', '', 'Required API key', tString)
```

### Use Descriptive Names

```typescript
// Good
new GGSetting('server/port', 3000, 'HTTP server listening port', tPosInt)

// Avoid
new GGSetting('p', 3000, '', tPosInt)
```
