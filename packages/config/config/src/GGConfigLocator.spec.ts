import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {IsObject, IsPosInt, IsString} from "@grest-ts/schema";
import {GGLocatorScope} from "@grest-ts/locator";
import {GGConfig} from './GGConfig';
import {GGConfigLocator, GGConfigLocatorOptions} from './GGConfigLocator';
import {GGConfigKey, GGConfigKeyConstructor} from './GGConfigKey';
import {GGConfigStore} from './GGConfigStore';
import {GGSecret} from './keys/GGSecret';
import {GGResource} from './keys/GGResource';

// The vitest setup loads testkit, which patches GGConfigLocator.add to wrap stores in GGConfigTestStore.
class PlainConfigLocator extends GGConfigLocator<any> {
    public override add<Key extends GGConfigKey>(key: GGConfigKeyConstructor<Key> | GGConfigKeyConstructor<Key>[], store: GGConfigStore<Key>): this {
        return this._add(key, store);
    }
}

class DocStore extends GGConfigStore<GGConfigKey> {
    public doc: Record<string, unknown> = {};
    public loads = 0;
    public bug: Error | undefined = undefined;
    #values = new Map<GGConfigKey, unknown>();

    public override async start(): Promise<void> {
        this.loads++;
        if (this.bug) throw this.bug;
        this.#values = this.resolveValues(key => this.doc[key.name], true);
        await super.start();
    }

    public getValue<T>(key: GGConfigKey<T>): T {
        return this.#values.get(key) as T;
    }
}

const Config = GGConfig.define("/locator_app/", () => ({
    token: new GGSecret("token", IsString.nonEmpty, "API token"),
    db: new GGResource("db", IsObject({host: IsString, port: IsPosInt}), "DB"),
}));

const valid = {"/locator_app/token": "t0k3n", "/locator_app/db": {host: "db", port: 5432}};
const until = (check: () => void) => vi.waitFor(check, {timeout: 3000, interval: 10});

describe('GGConfigLocator', () => {
    let scope: GGLocatorScope;
    let store: DocStore;
    let startupErrors: Error[];

    const locator = (options?: GGConfigLocatorOptions) => {
        const result = new PlainConfigLocator(Config, undefined, options).add([GGSecret, GGResource], store);
        result.onStartupError = (error) => void startupErrors.push(error);
        return result;
    };

    beforeEach(() => {
        scope = new GGLocatorScope("config-locator-test");
        scope.setLifecycleOwner(() => undefined);
        store = new DocStore();
        startupErrors = [];
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('names every failing key in one error, without the failing values', () => scope.run(async () => {
        store.doc = {"/locator_app/token": "", "/locator_app/db": {host: "super-secret-host", port: -1}};
        const error = await locator().start().then(() => undefined, (e: Error) => e);
        expect(error?.message).toBe('Config validation failed during initial-load:\n' +
            '\t"/locator_app/token": Value must not be empty\n' +
            '\t"/locator_app/db": port: Value must be at least 1');
    }));

    it('fails startup at once outside production', () => scope.run(async () => {
        await expect(locator().start()).rejects.toThrow(/\/locator_app\/token/);
        expect(store.loads).toBe(1);
        expect(startupErrors).toEqual([]);
    }));

    it('in production, keeps retrying until the config loads, then starts', () => scope.run(async () => {
        vi.stubEnv("NODE_ENV", "production");
        const loc = locator({startupRetryMs: 10});
        let started = false;
        const starting = loc.start().then(() => started = true);

        await until(() => expect(startupErrors.length).toBeGreaterThanOrEqual(2));
        expect(started).toBe(false);
        expect(startupErrors[0].message).toMatch(/\/locator_app\/token/);

        store.doc = valid;
        await starting;
        expect(store.getValue(Config.token)).toBe("t0k3n");
        await loc.teardown();
    }));

    it('in production, retries by default', () => scope.run(async () => {
        vi.stubEnv("NODE_ENV", "production");
        const loc = locator();
        const starting = loc.start();
        await until(() => expect(startupErrors).toHaveLength(1));
        expect(startupErrors[0].message).toMatch(/\/locator_app\/token/);
        await loc.teardown();
        await expect(starting).rejects.toThrow(/aborted by teardown/);
    }));

    it('in production, startupRetryMs 0 fails startup at once', () => scope.run(async () => {
        vi.stubEnv("NODE_ENV", "production");
        await expect(locator({startupRetryMs: 0}).start()).rejects.toThrow(/\/locator_app\/token/);
        expect(startupErrors).toEqual([]);
    }));

    it('in production, gives up after startupTimeoutMs with the last error', () => scope.run(async () => {
        vi.stubEnv("NODE_ENV", "production");
        await expect(locator({startupRetryMs: 10, startupTimeoutMs: 50}).start()).rejects.toThrow(/\/locator_app\/token/);
        expect(store.loads).toBeGreaterThan(1);
    }));

    it('in production, fails startup at once on an error that is not a config load error', () => scope.run(async () => {
        vi.stubEnv("NODE_ENV", "production");
        store.bug = new TypeError("store bug");
        await expect(locator({startupRetryMs: 10}).start()).rejects.toThrow("store bug");
        expect(store.loads).toBe(1);
        expect(startupErrors).toEqual([]);
    }));

    it('in production, teardown aborts a paused startup', () => scope.run(async () => {
        vi.stubEnv("NODE_ENV", "production");
        const loc = locator({startupRetryMs: 60_000});
        const starting = loc.start();
        await until(() => expect(startupErrors).toHaveLength(1));

        await loc.teardown();
        await expect(starting).rejects.toThrow(/aborted by teardown/);
        expect(store.loads).toBe(1);
    }));
});
