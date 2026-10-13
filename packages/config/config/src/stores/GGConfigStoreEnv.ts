import {GGConfigStore} from "../GGConfigStore";
import {GGConfigKey} from "../GGConfigKey";

export interface GGConfigStoreEnvOptions {
    /** Prepended to every variable name, e.g. "MYAPP_". */
    prefix?: string
    env?: NodeJS.ProcessEnv
}

/**
 * Reads config from environment variables, for processes whose deployment hands them config
 * as env (systemd EnvironmentFile, containers). Key `/app/db/host` reads `{prefix}DB_HOST` —
 * the config root is dropped, `/` becomes `_`. An unset or empty variable falls back to the
 * key's default. A value the key's schema rejects as a plain string is JSON-parsed, so
 * numbers, booleans and objects work.
 */
export class GGConfigStoreEnv<Key extends GGConfigKey = GGConfigKey> extends GGConfigStore<Key> {

    readonly #prefix: string;
    readonly #env: NodeJS.ProcessEnv;
    readonly #valuesCache = new Map<GGConfigKey, unknown>();

    constructor(options: GGConfigStoreEnvOptions = {}) {
        super();
        this.#prefix = options.prefix ?? "";
        this.#env = options.env ?? process.env;
    }

    public variableName(key: GGConfigKey): string {
        return this.#prefix + key.name.slice(key.root.length).replaceAll("/", "_").toUpperCase();
    }

    public override async start(): Promise<void> {
        this.keys.forEach(key => {
            this.#valuesCache.set(key, this.resolveValue(key, this.read(key), true));
        });
        await super.start();
    }

    public override async teardown(): Promise<void> {
        this.#valuesCache.clear();
        await super.teardown();
    }

    public getValue<T>(key: GGConfigKey<T>): T {
        return this.#valuesCache.get(key) as T;
    }

    private read(key: GGConfigKey): unknown {
        const raw = this.#env[this.variableName(key)];
        if (raw === undefined || raw === "") return undefined;
        if (key.schema.safeParse(raw).success) return raw;
        try {
            return JSON.parse(raw);
        } catch {
            return raw;
        }
    }
}
