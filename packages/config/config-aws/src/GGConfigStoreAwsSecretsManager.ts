import {SecretsManagerClient, GetSecretValueCommand} from "@aws-sdk/client-secrets-manager";
import {GGConfigStore} from "@grest-ts/config";
import {GGConfigKey} from "@grest-ts/config";

export interface GGConfigStoreAwsSecretsManagerOptions {
    readonly secretName: string;
    readonly region?: string;
    readonly accessKeyId?: string;
    readonly secretAccessKey?: string;
}

/**
 * AWS Secrets Manager config store.
 * Fetches a single JSON blob from Secrets Manager at startup and serves values from cache.
 * Path resolution is identical to GGConfigStoreFile: key.name.split("/") walks the JSON tree.
 */
export class GGConfigStoreAwsSecretsManager<Key extends GGConfigKey> extends GGConfigStore<Key> {

    private readonly options: GGConfigStoreAwsSecretsManagerOptions;
    private client: SecretsManagerClient | null = null;
    readonly #valuesCache: Map<GGConfigKey, unknown> = new Map();

    constructor(options: GGConfigStoreAwsSecretsManagerOptions) {
        super();
        this.options = options;
    }

    public override async start(): Promise<void> {
        this.client = new SecretsManagerClient({
            region: this.options.region,
            ...(this.options.accessKeyId && this.options.secretAccessKey ? {
                credentials: {
                    accessKeyId: this.options.accessKeyId,
                    secretAccessKey: this.options.secretAccessKey,
                },
            } : {}),
        });

        const response = await this.client.send(new GetSecretValueCommand({
            SecretId: this.options.secretName,
        }));

        if (!response.SecretString) {
            throw new Error(`AWS Secrets Manager secret "${this.options.secretName}" has no string value`);
        }

        const secretJson = JSON.parse(response.SecretString);

        this.keys.forEach(key => {
            const path = key.name.split("/");
            let val: any = undefined;
            if (path.length > 1) {
                val = secretJson;
                for (let i = 1; i < path.length; i++) {
                    val = val?.[path[i]];
                }
            }
            this.#valuesCache.set(key, this.resolveValue(key, val, true));
        });

        await super.start();
    }

    public override async teardown(): Promise<void> {
        if (this.client) {
            this.client.destroy();
            this.client = null;
        }
        this.#valuesCache.clear();
        await super.teardown();
    }

    public getValue<T>(key: GGConfigKey<T>): T {
        return this.#valuesCache.get(key) as T;
    }
}
