import {SecretsManagerClient, GetSecretValueCommand} from "@aws-sdk/client-secrets-manager";
import {GGConfigStore, GGConfigKey, GG_CONFIG, readConfigPath} from "@grest-ts/config";
import {isDeepStrictEqual} from "node:util";

export interface GGConfigStoreAwsSecretsManagerOptions {
    readonly secretName: string;
    readonly region?: string;
    readonly accessKeyId?: string;
    readonly secretAccessKey?: string;
    /** How often to check the secret for a new version. Default 3 minutes. */
    readonly refreshIntervalMs?: number;
}

/**
 * AWS Secrets Manager config store.
 * Fetches a single JSON blob from Secrets Manager at startup and serves values from cache.
 * Polls for a new secret version every refreshIntervalMs: a valid one replaces all values and notifies watchers of changed keys,
 * an invalid one is reported via GGConfigLocator.onReloadError and the last good values stay.
 * Path resolution is identical to GGConfigStoreFile (readConfigPath): `/app/db/host` → `json.app.db.host`.
 */
export class GGConfigStoreAwsSecretsManager<Key extends GGConfigKey> extends GGConfigStore<Key> {

    private readonly options: GGConfigStoreAwsSecretsManagerOptions;
    private client: SecretsManagerClient | null = null;
    #valuesCache: Map<GGConfigKey, unknown> = new Map();
    #versionId: string | undefined = undefined;
    #refreshTimer: NodeJS.Timeout | null = null;

    constructor(options: GGConfigStoreAwsSecretsManagerOptions) {
        super();
        this.options = options;
    }

    public override async start(): Promise<void> {
        this.client ??= new SecretsManagerClient({
            region: this.options.region,
            ...(this.options.accessKeyId && this.options.secretAccessKey ? {
                credentials: {
                    accessKeyId: this.options.accessKeyId,
                    secretAccessKey: this.options.secretAccessKey,
                },
            } : {}),
        });

        const secret = await this.#fetch();
        this.#valuesCache = this.resolveValues(new Map(this.keys.map(key => [key, readConfigPath(secret.json, key.name)])), true);
        this.#versionId = secret.versionId;

        await super.start();
        this.#scheduleRefresh();
    }

    public override async teardown(): Promise<void> {
        clearTimeout(this.#refreshTimer ?? undefined);
        this.#refreshTimer = null;
        if (this.client) {
            this.client.destroy();
            this.client = null;
        }
        this.#valuesCache.clear();
        this.#versionId = undefined;
        await super.teardown();
    }

    public async refresh(): Promise<void> {
        const secret = await this.#fetch();
        if (!this.isStarted || secret.versionId === this.#versionId) return;
        const values = this.resolveValues(new Map(this.keys.map(key => [key, readConfigPath(secret.json, key.name)])), false);
        const previous = this.#valuesCache;
        this.#valuesCache = values;
        this.#versionId = secret.versionId;
        const changed = this.keys.filter(key => !isDeepStrictEqual(previous.get(key), values.get(key)));
        await Promise.all(changed.map(key => this.notify(key).catch(this.#reportReloadError)));
    }

    public getValue<T>(key: GGConfigKey<T>): T {
        return this.#valuesCache.get(key) as T;
    }

    async #fetch(): Promise<{ versionId: string | undefined, json: unknown }> {
        const response = await this.client!.send(new GetSecretValueCommand({
            SecretId: this.options.secretName,
        }));
        if (!response.SecretString) {
            throw new Error(`AWS Secrets Manager secret "${this.options.secretName}" has no string value`);
        }
        try {
            return {versionId: response.VersionId, json: JSON.parse(response.SecretString)};
        } catch {
            // The parser's message quotes the text around the error, which is secret.
            throw new Error(`AWS Secrets Manager secret "${this.options.secretName}" is not valid JSON`);
        }
    }

    #scheduleRefresh(): void {
        this.#refreshTimer = setTimeout(async () => {
            await this.refresh().catch(error => {
                if (this.isStarted) this.#reportReloadError(error);
            });
            if (this.isStarted) this.#scheduleRefresh();
        }, this.options.refreshIntervalMs ?? 180_000);
        this.#refreshTimer.unref();
    }

    #reportReloadError = (error: Error): void => GG_CONFIG.get().onReloadError(error);
}
