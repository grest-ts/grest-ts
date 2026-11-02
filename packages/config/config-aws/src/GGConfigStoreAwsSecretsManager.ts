import {SecretsManagerClient, GetSecretValueCommand} from "@aws-sdk/client-secrets-manager";
import {GGConfigStore, GGConfigKey, GGConfigLoadError, parseConfigJson, readConfigPath} from "@grest-ts/config";

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
    // Bumped by teardown, so a fetch or poll that was in flight across it neither starts nor reschedules anything.
    #generation = 0;

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

        const generation = this.#generation;
        await this.#refresh(true, generation);
        if (generation !== this.#generation) throw new Error(`AWS Secrets Manager store "${this.options.secretName}" was torn down while starting`);
        await super.start();
        this.#scheduleRefresh();
    }

    public override async teardown(): Promise<void> {
        this.#generation++;
        clearTimeout(this.#refreshTimer ?? undefined);
        this.#refreshTimer = null;
        if (this.client) {
            this.client.destroy();
            this.client = null;
        }
        this.#valuesCache.clear();
        await super.teardown();
    }

    async #refresh(isInitialLoad: boolean, generation: number): Promise<void> {
        const json = await this.#fetch();
        if (generation !== this.#generation) return;
        const values = this.resolveValues(key => readConfigPath(json, key.name), isInitialLoad);
        const previous = this.#valuesCache;
        this.#valuesCache = values;
        if (!isInitialLoad) await this.notifyChanged(previous, values);
    }

    public getValue<T>(key: GGConfigKey<T>): T {
        return this.#valuesCache.get(key) as T;
    }

    async #fetch(): Promise<unknown> {
        const name = this.options.secretName;
        const {SecretString} = await this.client!.send(new GetSecretValueCommand({SecretId: name})).catch(error => {
            throw new GGConfigLoadError(`Cannot read AWS Secrets Manager secret "${name}": ${error.name}: ${error.message}`, {cause: error});
        });
        if (SecretString === undefined) throw new GGConfigLoadError(`AWS Secrets Manager secret "${name}" has no string value`);
        return parseConfigJson(SecretString, `AWS Secrets Manager secret "${name}"`);
    }

    #scheduleRefresh(): void {
        const generation = this.#generation;
        this.#refreshTimer = setTimeout(async () => {
            try {
                await this.#refresh(false, generation);
            } catch (error) {
                if (generation === this.#generation) this.reportReloadError(error as Error);
            }
            if (generation === this.#generation) this.#scheduleRefresh();
        }, this.options.refreshIntervalMs ?? 180_000);
        this.#refreshTimer.unref();
    }
}
