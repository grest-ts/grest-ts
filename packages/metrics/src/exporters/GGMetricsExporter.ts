import {GGMetricsStore} from "../GGMetricsStore.js";
import {GG_METRICS} from "../GGMetricsLoader.js";
import {GGMetric} from "../GGMetric.js";
import {GGMetricKey} from "../GGMetricKey.js";

export interface ExporterConfig {
    store?: GGMetricsStore;
    include?: unknown[];
    exclude?: unknown[];
}

/**
 * Abstract base class for metrics exporters.
 * Handles config parsing, metric filtering, and key discovery.
 */
export abstract class GGMetricsExporter<TOutput> {
    protected readonly store: GGMetricsStore;
    private readonly includeKeys?: Set<GGMetricKey<any>>;
    private readonly excludeKeys?: Set<GGMetricKey<any>>;

    constructor(config: ExporterConfig = {}) {
        this.store = config.store ?? GG_METRICS.get();
        this.includeKeys = config.include ? this.discoverKeys(config.include) : undefined;
        this.excludeKeys = config.exclude ? this.discoverKeys(config.exclude) : undefined;
    }

    /**
     * Discover all GGMetricKey instances from an array of objects.
     * Objects can be individual keys, or nested structures containing keys.
     */
    private discoverKeys(objects: unknown[]): Set<GGMetricKey<any>> {
        const keys = new Set<GGMetricKey<any>>();
        for (const obj of objects) {
            this.discoverKeysRecursive(obj, keys);
        }
        return keys;
    }

    private discoverKeysRecursive(obj: unknown, keys: Set<GGMetricKey<any>>): void {
        if (obj instanceof GGMetricKey) {
            keys.add(obj);
        } else if (obj && typeof obj === 'object') {
            for (const value of Object.values(obj)) {
                this.discoverKeysRecursive(value, keys);
            }
        }
    }

    /**
     * Check if a metric should be included in the export.
     * Exclude takes precedence over include.
     */
    protected shouldIncludeMetric(metric: GGMetric<any>): boolean {
        // Exclude takes precedence
        if (this.excludeKeys?.has(metric.key)) {
            return false;
        }
        // If include is set, only include those
        if (this.includeKeys) {
            return this.includeKeys.has(metric.key);
        }
        // Default: include all
        return true;
    }

    /**
     * Get all metrics that pass the include/exclude filters.
     */
    protected* getFilteredMetrics(): Iterable<GGMetric<any>> {
        for (const metric of this.store.getAllMetrics()) {
            if (this.shouldIncludeMetric(metric)) {
                yield metric;
            }
        }
    }

    /**
     * Export metrics to the output format.
     */
    abstract getMetrics(): TOutput;

    /**
     * Export metrics as a JSON string.
     */
    getMetricsString(): string {
        return JSON.stringify(this.getMetrics(), null, 2);
    }
}
