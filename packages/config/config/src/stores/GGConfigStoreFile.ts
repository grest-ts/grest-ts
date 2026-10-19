import * as fs from 'fs';
import {GGConfigStore} from "../GGConfigStore";
import {GGConfigKey} from "../GGConfigKey";
import {GG_CONFIG} from "../GG_CONFIG";
import {readConfigPath} from "../configPath";
import {basename, dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {isDeepStrictEqual} from "node:util";

/**
 * Reads settings from a JSON file and reloads when the file is written or replaced.
 */
export class GGConfigStoreFile<Key extends GGConfigKey> extends GGConfigStore<Key> {

    private readonly file: string;
    #watcher: fs.FSWatcher | null = null;
    #debounceTimer: NodeJS.Timeout | null = null;
    #valuesCache: Map<GGConfigKey, unknown> = new Map();

    constructor(file: string, moduleUrl?: string) {
        super();
        const prefix = moduleUrl ? dirname(fileURLToPath(moduleUrl)) : "";
        this.file = join(prefix, file);
    }

    public override async start(): Promise<void> {
        await super.start();
        await this.refresh(true);
        // Watch the directory: atomic writes rename a new inode over the file, which a file watch never sees.
        const name = basename(this.file);
        this.#watcher = fs.watch(dirname(this.file), (_eventType, filename) => {
            if (filename && filename !== name) return;
            if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
            // Adding debounce so file writes would have time to correctly complete.
            this.#debounceTimer = setTimeout(() => this.refresh(false).catch(this.#reportReloadError), 100);
        });
        this.#watcher.on('error', this.#reportReloadError);
    }

    public override async teardown(): Promise<void> {
        if (this.#watcher) {
            this.#watcher.close();
            this.#watcher = null;
        }
        clearTimeout(this.#debounceTimer ?? undefined);
        this.#debounceTimer = null;
        await super.teardown();
    }

    public async refresh(isInitialLoad: boolean): Promise<void> {
        const fileContent = fs.readFileSync(this.file, 'utf-8');
        if (!fileContent) {
            throw new Error(`Settings file is empty: ${this.file}`)
        }
        const fileJson = JSON.parse(fileContent);
        const values = new Map<GGConfigKey, unknown>();
        this.keys.forEach(key => {
            values.set(key, this.resolveValue(key, readConfigPath(fileJson, key.name), isInitialLoad));
        });
        const previous = this.#valuesCache;
        this.#valuesCache = values;
        if (isInitialLoad) return;
        const changed = this.keys.filter(key => !isDeepStrictEqual(previous.get(key), values.get(key)));
        await Promise.all(changed.map(key => this.notify(key).catch(this.#reportReloadError)));
    }

    #reportReloadError = (error: Error): void => GG_CONFIG.get().onReloadError(error);

    public getValue<T>(key: GGConfigKey<T>): T {
        return this.#valuesCache.get(key) as T;
    }

}
