import {SecretsManagerClient, GetSecretValueCommand} from "@aws-sdk/client-secrets-manager";
import {GGConfigStore, GGConfigKey, readConfigPath} from "@grest-ts/config";

export interface GGConfigStoreAwsSecretsManagerOptions {
    readonly secretName: string;
    readonly region?: string;
    readonly accessKeyId?: string;
    readonly secretAccessKey?: string;
    /** How often to re-read the secret. Default 3 minutes. */
    readonly refreshIntervalMs?: number;
}

/**
 * AWS Secrets Manager config store.
 * Fetches a single JSON blob from Secrets Manager at startup and serves values from cache.
 * Re-reads the secret every refreshIntervalMs: valid content replaces all values and notifies watchers of changed keys,
 * invalid content is reported via GGConfigLocator.onReloadError and the last good values stay.
 * Path resolution is identical to GGConfigStoreFile (readConfigPath): `/app/db/host` → `json.app.db.host`.
 */
export class GGConfigStoreAwsSecretsManager<Key extends GGConfigKey> extends GGConfigStore<Key> {

    private readonly options: GGConfigStoreAwsSecretsManagerOptions;
    private client: SecretsManagerClient | null = null;
    #valuesCache: Map<GGConfigKey, unknown> = new Map();
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

        await this.refresh(true);
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
        await super.teardown();
    }

    public async refresh(isInitialLoad: boolean = false): Promise<void> {
        const json = await this.#fetch();
        if (!isInitialLoad && !this.isStarted) return;
        const values = this.resolveValues(key => readConfigPath(json, key.name), isInitialLoad);
        const previous = this.#valuesCache;
        this.#valuesCache = values;
        if (!isInitialLoad) await this.notifyChanged(previous, values);
    }

    public getValue<T>(key: GGConfigKey<T>): T {
        return this.#valuesCache.get(key) as T;
    }

    async #fetch(): Promise<unknown> {
        const response = await this.client!.send(new GetSecretValueCommand({
            SecretId: this.options.secretName,
        }));
        if (!response.SecretString) {
            throw new Error(`AWS Secrets Manager secret "${this.options.secretName}" has no string value`);
        }
        try {
            return JSON.parse(response.SecretString);
        } catch {
            // The parser's message quotes the text around the error, which is secret.
            throw new Error(`AWS Secrets Manager secret "${this.options.secretName}" is not valid JSON`);
        }
    }

    #scheduleRefresh(): void {
        this.#refreshTimer = setTimeout(async () => {
            await this.refresh().catch(error => {
                if (this.isStarted) this.reportReloadError(error);
            });
            if (this.isStarted) this.#scheduleRefresh();
        }, this.options.refreshIntervalMs ?? 180_000);
        this.#refreshTimer.unref();
    }
}
