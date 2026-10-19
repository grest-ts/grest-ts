import * as fs from 'fs';
import {GGConfigStore} from "../GGConfigStore";
import {GGConfigKey} from "../GGConfigKey";
import {GG_CONFIG} from "../GG_CONFIG";
import {readConfigPath} from "../configPath";
import {basename, dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {isDeepStrictEqual} from "node:util";

/**
 * Local file-based settings strategy.
 * Reads settings from settings.json in the config directory.
 * Watches file for changes and automatically reloads.
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
            this.#debounceTimer = setTimeout(() => {
                this.#debounceTimer = null;
                if (!this.isStarted) return;
                this.refresh(false).catch(error => GG_CONFIG.get().onReloadError(error));
            }, 100);
        });
        this.#watcher.on('error', error => GG_CONFIG.get().onReloadError(error));
    }

    public override async teardown(): Promise<void> {
        if (this.#watcher) {
            this.#watcher.close();
            this.#watcher = null;
        }
        if (this.#debounceTimer) {
            clearTimeout(this.#debounceTimer);
            this.#debounceTimer = null;
        }
        await super.teardown();
    }

    public async refresh(isInitialLoad: boolean): Promise<void> {
        let fileContent: string;
        try {
            fileContent = fs.readFileSync(this.file, 'utf-8');
        } catch (error) {
            // Mid-replace the file can be briefly absent; its reappearance triggers another reload.
            if (!isInitialLoad && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw error;
        }
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
        await Promise.all(changed.map(key => this.notify(key).catch(error => GG_CONFIG.get().onReloadError(error))));
    }

    public getValue<T>(key: GGConfigKey<T>): T {
        return this.#valuesCache.get(key) as T;
    }

}
