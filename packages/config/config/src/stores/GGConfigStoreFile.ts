import * as fs from 'fs';
import {GGConfigStore} from "../GGConfigStore";
import {GGConfigKey} from "../GGConfigKey";
import {parseConfigJson, readConfigPath} from "../configPath";
import {GGConfigLoadError} from "../GGConfigLoadError";
import {basename, dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

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
        await this.refresh(true);
        await super.start();
        // Watch the directory: atomic writes rename a new inode over the file, which a file watch never sees.
        const name = basename(this.file);
        this.#watcher = fs.watch(dirname(this.file), (_eventType, filename) => {
            if (filename && filename !== name) return;
            if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
            // Adding debounce so file writes would have time to correctly complete.
            this.#debounceTimer = setTimeout(() => this.refresh(false).catch(this.reportReloadError), 100);
        });
        this.#watcher.on('error', this.reportReloadError);
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
        const fileJson = this.#read();
        const values = this.resolveValues(key => readConfigPath(fileJson, key.name), isInitialLoad);
        const previous = this.#valuesCache;
        this.#valuesCache = values;
        if (!isInitialLoad) await this.notifyChanged(previous, values);
    }

    #read(): unknown {
        let fileContent: string;
        try {
            fileContent = fs.readFileSync(this.file, 'utf-8');
        } catch (error) {
            throw new GGConfigLoadError(`Cannot read settings file ${this.file}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`, {cause: error});
        }
        return parseConfigJson(fileContent, `Settings file ${this.file}`);
    }

    public getValue<T>(key: GGConfigKey<T>): T {
        return this.#valuesCache.get(key) as T;
    }

}
