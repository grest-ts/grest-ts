import * as fs from 'fs';
import {GGConfigStore} from "../GGConfigStore";
import {GGConfigKey} from "../GGConfigKey";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

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
        this.#watcher = fs.watch(this.file, (eventType) => {
            if (eventType === 'change') {
                if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
                // Adding debounce so file writes would have time to correctly complete.
                this.#debounceTimer = setTimeout(() => this.refresh(false), 100);
            }
        });
    }

    public override async teardown(): Promise<void> {
        if (this.#watcher) {
            this.#watcher.close();
            this.#watcher = null;
        }
        await super.teardown();
    }

    public async refresh(isInitialLoad: boolean): Promise<void> {
        const fileContent = fs.readFileSync(this.file, 'utf-8');
        if (!fileContent) {
            throw new Error("Settings file is empty! Why is that?")
        }
        const fileJson = JSON.parse(fileContent);
        this.#valuesCache.clear();
        this.keys.forEach(key => {
            const path = key.name.split("/");
            let val: any = undefined;
            if (path.length > 1) {
                val = fileJson;
                for (let i = 1; i < path.length; i++) {
                    val = val?.[path[i]]
                }
            }
            this.#valuesCache.set(key, this.resolveValue(key, val, isInitialLoad));
        });
    }

    public getValue<T>(key: GGConfigKey<T>): T {
        return this.#valuesCache.get(key) as T;
    }

}
