import {GGMetricsStore} from "../src/GGMetricsStore.js";
import {GGMetric} from "../src/GGMetric.js";
import {GGCounter} from "../src/metric/GGCounter.js";
import {GGGauge} from "../src/metric/GGGauge.js";
import {GGHistogram, HistogramData} from "../src/metric/GGHistogram.js";

/**
 * Test exporter that creates deep copies of metric data for assertions.
 * Use this in tests when you need to capture metric state at a point in time.
 */
export class GGTestMetricsExporter {
    constructor(private readonly store: GGMetricsStore) {
    }

    /**
     * Creates a snapshot of all metrics with deep-copied values.
     */
    snapshot(): TestMetricsSnapshot {
        const metrics: TestMetricSnapshot[] = [];

        for (const metric of this.store.getAllMetrics()) {
            metrics.push(this.snapshotMetric(metric));
        }

        return {metrics};
    }

    /**
     * Get a specific counter's value for given labels.
     */
    getCounterValue(name: string, labels?: Record<string, string>): number | undefined {
        for (const metric of this.store.getAllMetrics()) {
            if (metric.name === name && metric instanceof GGCounter) {
                const key = this.labelsToKey(labels);
                return metric.getValues().get(key);
            }
        }
        return undefined;
    }

    /**
     * Get a specific gauge's value for given labels.
     */
    getGaugeValue(name: string, labels?: Record<string, string>): number | undefined {
        for (const metric of this.store.getAllMetrics()) {
            if (metric.name === name && metric instanceof GGGauge) {
                const key = this.labelsToKey(labels);
                return metric.getValues().get(key);
            }
        }
        return undefined;
    }

    /**
     * Get a specific histogram's data for given labels.
     */
    getHistogramValue(name: string, labels?: Record<string, string>): HistogramData | undefined {
        for (const metric of this.store.getAllMetrics()) {
            if (metric.name === name && metric instanceof GGHistogram) {
                const key = this.labelsToKey(labels);
                const data = metric.getValues().get(key);
                if (data) {
                    // Deep copy
                    return {
                        count: data.count,
                        sum: data.sum,
                        min: data.min,
                        max: data.max,
                        values: [...data.values]
                    };
                }
            }
        }
        return undefined;
    }

    private snapshotMetric(metric: GGMetric<any>): TestMetricSnapshot {
        if (metric instanceof GGCounter) {
            return {
                name: metric.name,
                type: 'counter',
                help: metric.key.help,
                labelNames: metric.key.labelNames,
                values: new Map(metric.getValues())
            };
        } else if (metric instanceof GGGauge) {
            return {
                name: metric.name,
                type: 'gauge',
                help: metric.key.help,
                labelNames: metric.key.labelNames,
                values: new Map(metric.getValues())
            };
        } else if (metric instanceof GGHistogram) {
            const values = new Map<string, HistogramData>();
            for (const [key, data] of metric.getValues() as Map<string, HistogramData>) {
                values.set(key, {
                    count: data.count,
                    sum: data.sum,
                    min: data.min,
                    max: data.max,
                    values: [...data.values]
                });
            }
            return {
                name: metric.name,
                type: 'histogram',
                help: metric.key.help,
                labelNames: metric.key.labelNames,
                buckets: metric.getBuckets(),
                values
            };
        }
        throw new Error(`Unknown metric type: ${metric.constructor.name}`);
    }

    private labelsToKey(labels?: Record<string, string>): string {
        if (!labels) return '';
        return Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`)
            .join(',');
    }
}

export interface TestMetricsSnapshot {
    metrics: TestMetricSnapshot[];
}

export interface TestMetricSnapshot {
    name: string;
    type: 'counter' | 'gauge' | 'histogram';
    help: string;
    labelNames: readonly string[];
    buckets?: readonly number[];
    values: Map<string, number | HistogramData>;
}
