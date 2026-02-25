# Extending Config

## Custom Key Types

Create new key types by extending `GGConfigKey`:

```typescript
import {GGConfigKey} from "@grest-ts/config"
import {GGValidator} from "@grest-ts/schema"
import {deepFreeze} from "@grest-ts/common"

export class GGFeatureFlag<T> extends GGConfigKey<T> {

    public static readonly NAME = "[GGFeatureFlag]";

    readonly #default: T;

    constructor(name: string, schema: GGValidator<T>, defaultValue: T, description: string) {
        super(name, schema, description);
        this.#default = deepFreeze(defaultValue);
    }

    public override getDefault(): T {
        return this.#default;
    }

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
    darkMode: new GGFeatureFlag('darkMode', IsBoolean, false, 'Dark mode toggle'),
    newCheckout: new GGFeatureFlag('newCheckout', IsBoolean, false, 'New checkout flow')
}));

if (Features.darkMode.isEnabled()) {
    // ...
}
```

## Custom Stores

Create custom storage backends by extending `GGConfigStore`:

```typescript
import {GGConfigStore, GGConfigKey} from "@grest-ts/config"

export class GGConfigStoreEnv extends GGConfigStore<GGConfigKey> {

    readonly #cache = new Map<GGConfigKey, unknown>();

    public override async start(): Promise<void> {
        this.keys.forEach(key => {
            // Convert /app/server/port to APP_SERVER_PORT
            const envKey = key.name
                .replace(/\//g, '_')
                .toUpperCase()
                .replace(/^_/, '');

            const envValue = process.env[envKey];
            this.#cache.set(key, this.resolveValue(key, envValue, true));
        });
        await super.start();
    }

    public getValue<T>(key: GGConfigKey<T>): T {
        return this.#cache.get(key) as T;
    }
}
```

Usage:

```typescript
import {GGConfigLocator, GGSecret} from "@grest-ts/config"

new GGConfigLocator(AppConfig)
    .add(GGSecret, new GGConfigStoreEnv())
```

## Remote Configuration Store

Example fetching config from a remote service:

```typescript
export class GGConfigStoreRemote extends GGConfigStore<GGConfigKey> {

    readonly #cache = new Map<GGConfigKey, unknown>();
    private readonly url: string;

    constructor(url: string) {
        super();
        this.url = url;
    }

    public override async start(): Promise<void> {
        await this.load(true);
        await super.start();
    }

    private async load(isInitialLoad: boolean): Promise<void> {
        const response = await fetch(this.url);
        const config = await response.json();

        for (const key of this.keys) {
            const path = key.name.split('/').filter(s => s);
            let value: any = config;
            for (const segment of path) {
                value = value?.[segment];
            }
            this.#cache.set(key, this.resolveValue(key, value, isInitialLoad));
        }

        // Notify watchers on reload
        if (!isInitialLoad) {
            for (const key of this.keys) {
                await this.notify(key);
            }
        }
    }

    public async reload(): Promise<void> {
        await this.load(false);
    }

    public getValue<T>(key: GGConfigKey<T>): T {
        return this.#cache.get(key) as T;
    }
}
```

## Registering Custom Stores

Register stores for custom key types using `.add()`:

```typescript
new GGConfigLocator(AppConfig)
    .add(GGSetting, new GGConfigStoreFile('settings.json', import.meta.url))
    .add(GGSecret, new GGConfigStoreEnv())
    .add(GGResource, new GGConfigStoreRemote('https://config.example.com/resources'))
    .add(GGFeatureFlag, new GGConfigStoreRemote('https://config.example.com/features'))
```
