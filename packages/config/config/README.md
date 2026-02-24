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

## Quick usage example

```typescript
import {GGConfig, GGResource, GGSecret, GGSetting} from "@grest-ts/config"

// Define configuration keys
export const AppConfig = GGConfig.define('/app/', () => ({
    port: new GGSetting('port', 3000, 'Server port', IsInt),
    apiKey: new GGSecret('apiKey', '', 'External API key', IsString),
    dbUrl: new GGResource('db/url', 'localhost:5432', 'Database URL', IsString)
}));

// Usage in runtime
const port = AppConfig.port.get();
const apiKey = AppConfig.apiKey.reveal();
const dbUrl = AppConfig.dbUrl.get(); // if value changes, you get the new value

// Watch for changes (in case you need to) - as a simple example: you need to roll a mysql user password and start a new pool without any downtime.
AppConfig.dbUrl.watch(() => {
    // Do something when dbUrl changes
})

// Where actually values come from? You define the source in the runtime compose.
// in example we use a file (don't really use files, use proper services for each category!)
// These particular stores also watch the file for updates. Most stores should allow dynamic config updates!
// You can also add your own stores, groups etc rather easily.
new GGConfigLoader(new Map<any, any>([
    [GGSetting, new GGConfigStoreFile("./config/settings.json", import.meta.url)],
    [GGSecret, new GGConfigStoreFile("./config/secrets.json", import.meta.url)],
    [GGResource, new GGConfigStoreFile("./config/resources.json", import.meta.url)]
]));

```

## Documentation

- [Usage](./README-usage.md) - How to define and use configuration
- [Extending](./README-extending.md) - How to add custom key types and stores
