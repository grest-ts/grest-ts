import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {SecretsManagerClient} from "@aws-sdk/client-secrets-manager";
import {IsPosInt, IsString} from "@grest-ts/schema";
import {GGLocatorScope} from "@grest-ts/locator";
import {sleep} from "@grest-ts/common";
import {GGLog} from "@grest-ts/logger";
import {GGConfig, GGConfigKey, GGConfigKeyConstructor, GGConfigLocator, GGConfigStore, GGSecret, GGSetting} from "@grest-ts/config";
import {GGConfigStoreAwsSecretsManager} from "./GGConfigStoreAwsSecretsManager";

// The vitest setup loads testkit, which patches GGConfigLocator.add to wrap stores in GGConfigTestStore.
class PlainConfigLocator extends GGConfigLocator<any> {
    public override add<Key extends GGConfigKey>(key: GGConfigKeyConstructor<Key> | GGConfigKeyConstructor<Key>[], store: GGConfigStore<Key>): this {
        return this._add(key, store);
    }
}

const Config = GGConfig.define("/aws_app/", () => ({
    token: new GGSecret("token", IsString.nonEmpty, "API token"),
    port: new GGSetting("port", IsPosInt, 4000, "HTTP port"),
}));

const until = (check: () => void) => vi.waitFor(check, {timeout: 3000, interval: 10});

describe('GGConfigStoreAwsSecretsManager', () => {
    let scope: GGLocatorScope;
    let secret: { VersionId: string, SecretString: string };
    let send: ReturnType<typeof vi.spyOn>;
    let reloadErrors: Error[];

    const version = (id: string, doc: unknown) => secret = {VersionId: id, SecretString: typeof doc === "string" ? doc : JSON.stringify(doc)};
    const doc = (token: string, port?: number) => ({aws_app: {token, port}});

    const started = async () => {
        const store = new GGConfigStoreAwsSecretsManager<GGConfigKey>({secretName: "app/prod", region: "eu-west-1", refreshIntervalMs: 20});
        const locator = new PlainConfigLocator(Config).add([GGSecret, GGSetting], store);
        locator.onReloadError = (error) => void reloadErrors.push(error);
        await locator.start();
        return {store, locator};
    };

    beforeEach(() => {
        scope = new GGLocatorScope("config-aws-test");
        scope.setLifecycleOwner(() => undefined);
        reloadErrors = [];
        version("v1", doc("first"));
        send = vi.spyOn(SecretsManagerClient.prototype, "send").mockImplementation(async () => secret);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it('loads the secret at startup', () => scope.run(async () => {
        const {store, locator} = await started();
        expect([store.getValue(Config.token), store.getValue(Config.port)]).toEqual(["first", 4000]);
        await locator.teardown();
    }));

    it('applies a new version and notifies only changed keys', () => scope.run(async () => {
        const {store, locator} = await started();
        const token = vi.fn(), port = vi.fn();
        store.watch(Config.token, token);
        store.watch(Config.port, port);

        version("v2", doc("second"));
        await until(() => expect(token).toHaveBeenCalledExactlyOnceWith("second"));
        expect(store.getValue(Config.token)).toBe("second");
        expect(port).not.toHaveBeenCalled();
        await locator.teardown();
    }));

    it('logs each changed key, with the value for settings but never for secrets', () => scope.run(async () => {
        const {store, locator} = await started();
        const info = vi.spyOn(GGLog, "info").mockImplementation(() => undefined);
        version("v2", doc("second-secret", 8080));
        await until(() => expect(store.getValue(Config.port)).toBe(8080));
        const lines = info.mock.calls.map(call => call[1]);
        expect(lines).toEqual(expect.arrayContaining([
            'Config "/aws_app/token" changed: (secret) → (secret)',
            'Config "/aws_app/port" changed: 4000 → 8080',
        ]));
        expect(JSON.stringify(info.mock.calls.map(call => call.slice(1)))).not.toContain("second-secret");
        await locator.teardown();
    }));

    it('pauses a production startup while the secret cannot be read, then starts', () => scope.run(async () => {
        vi.stubEnv("NODE_ENV", "production");
        send.mockRejectedValueOnce(Object.assign(new Error("Secrets Manager can't find the specified secret."), {name: "ResourceNotFoundException"}));
        const store = new GGConfigStoreAwsSecretsManager<GGConfigKey>({secretName: "app/prod", refreshIntervalMs: 60_000});
        const locator = new PlainConfigLocator(Config, undefined, {startupRetryMs: 10}).add([GGSecret, GGSetting], store);
        const startupErrors: Error[] = [];
        locator.onStartupError = (error) => void startupErrors.push(error);
        await locator.start();
        expect(startupErrors.map(e => e.message)).toEqual(['Cannot read AWS Secrets Manager secret "app/prod": ResourceNotFoundException: Secrets Manager can\'t find the specified secret.']);
        expect(store.getValue(Config.token)).toBe("first");
        await locator.teardown();
    }));

    it('does not notify while the secret is unchanged', () => scope.run(async () => {
        const {store, locator} = await started();
        const token = vi.fn();
        store.watch(Config.token, token);
        await until(() => expect(send.mock.calls.length).toBeGreaterThanOrEqual(3));
        expect(token).not.toHaveBeenCalled();
        await locator.teardown();
    }));

    it.each([
        ["a schema failure", doc(""), '"/aws_app/token": Value must not be empty'],
        ["invalid JSON", '{"aws_app": {"token": "leaked', 'AWS Secrets Manager secret "app/prod" is not valid JSON'],
    ])('keeps the last good values on %s, reports it on every poll without the secret, then applies a fix', (_, broken, message) => scope.run(async () => {
        const {store, locator} = await started();
        version("v2", broken);
        await until(() => expect(reloadErrors.length).toBeGreaterThanOrEqual(2));
        expect(reloadErrors[0].message).toContain(message);
        expect(reloadErrors[0].message).not.toContain("leaked");
        expect(store.getValue(Config.token)).toBe("first");

        version("v3", doc("fixed"));
        await until(() => expect(store.getValue(Config.token)).toBe("fixed"));
        await locator.teardown();
    }));

    it('can start again after a failed initial load', () => scope.run(async () => {
        const store = new GGConfigStoreAwsSecretsManager<GGConfigKey>({secretName: "app/prod", refreshIntervalMs: 20});
        store.setKeys([Config.token, Config.port]);
        version("v1", doc(""));
        await expect(store.start()).rejects.toThrow(/\/aws_app\/token/);
        version("v2", doc("ok"));
        await store.start();
        expect(store.getValue(Config.token)).toBe("ok");
        await store.teardown();
    }));

    it('does not start or poll when torn down during the initial fetch', () => scope.run(async () => {
        let release!: () => void;
        send.mockImplementationOnce(() => new Promise(resolve => release = () => resolve(secret)));
        const store = new GGConfigStoreAwsSecretsManager<GGConfigKey>({secretName: "app/prod", refreshIntervalMs: 20});
        store.setKeys([Config.token, Config.port]);
        const starting = store.start();
        await until(() => expect(release).toBeDefined());
        await store.teardown();
        release();

        await expect(starting).rejects.toThrow(/torn down while starting/);
        expect(store.started).toBe(false);
        await sleep(100);
        expect(send).toHaveBeenCalledTimes(1);
    }));

    it('stops polling after teardown', () => scope.run(async () => {
        const {locator} = await started();
        await locator.teardown();
        const calls = send.mock.calls.length;
        await sleep(100);
        expect(send.mock.calls.length).toBe(calls);
    }));
});
