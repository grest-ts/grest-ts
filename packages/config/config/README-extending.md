# Extending Config

## Custom Key Types

Create new key types by extending `GGConfigKey`:

```typescript
import {GGConfigKey} from "@grest-ts/config"

export class GGFeatureFlag<T> extends GGConfigKey<T> {

    public static readonly NAME = "[GGFeatureFlag]";

    public getStoreKey(): string {
        return GGFeatureFlag.NAME;
    }

    public isEnabled(): T {
        return this.getValue();
    }
}
```

Usage:

```typescript
export const Features = GGConfig.define('/features/', () => ({
    darkMode: new GGFeatureFlag('darkMode', false, 'Dark mode toggle', tBoolean),
    newCheckout: new GGFeatureFlag('newCheckout', false, 'New checkout flow', tBoolean)
}));

if (Features.darkMode.isEnabled()) {
    // ...
}
```

## Custom Stores

Create custom storage backends by extending `GGConfigStore`:

```typescript
import {GGConfigStore, GGConfigKey} from "@grest-ts/config"

export class GGConfigStoreEnv extends GGConfigStore {

    protected findValue<T>(key: GGConfigKey<T>): T {
        // Convert /app/server/port to APP_SERVER_PORT
        const envKey = key.name
            .replace(/\//g, '_')
            .toUpperCase()
            .replace(/^_/, '');

        const envValue = process.env[envKey];
        if (envValue === undefined) {
            return key.getDefault();
        }

        // Parse based on default value type
        if (typeof key.getDefault() === 'number') {
            return Number(envValue) as T;
        }
        if (typeof key.getDefault() === 'boolean') {
            return (envValue === 'true') as T;
        }
        return envValue as T;
    }
}
```

Usage:

```typescript
import {GGConfigLoader} from "@grest-ts/config"
import {GGSecret} from "@grest-ts/config"

new GGConfigLoader(new Map([
    [GGSecret, new GGConfigStoreEnv()]
]));
```

## Remote Configuration Store

Example fetching config from a remote service:

```typescript
export class GGConfigStoreRemote extends GGConfigStore {

    private config: Record<string, unknown> = {};
    private readonly url: string;

    constructor(url: string) {
        super();
        this.url = url;
    }

    public override async start(): Promise<void> {
        await super.start();
        await this.refresh();
    }

    public override async refresh(): Promise<void> {
        const response = await fetch(this.url);
        this.config = await response.json();
        await super.refresh(); // Notify watchers
    }

    protected findValue<T>(key: GGConfigKey<T>): T {
        const path = key.name.split('/').filter(s => s);
        let value: any = this.config;
        for (const segment of path) {
            value = value?.[segment];
        }
        return value ?? key.getDefault();
    }
}
```

## Registering Custom Stores

Register stores for custom key types in the loader:

```typescript
new GGConfigLoader(new Map([
    [GGSetting, new GGConfigStoreFile('settings.json', import.meta.url)],
    [GGSecret, new GGConfigStoreEnv()],
    [GGResource, new GGConfigStoreRemote('https://config.example.com/resources')], // Don't really use URL-s, you want discovery here!
    [GGFeatureFlag, new GGConfigStoreRemote('https://config.example.com/features')]
]));
```
