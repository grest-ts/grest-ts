import {GGMetric} from "../GGMetric.js";
import {GGCounter} from "../metric/GGCounter.js";
import {GGGauge} from "../metric/GGGauge.js";
import {GGLazyGauge} from "../metric/GGLazyGauge.js";
import {GGHistogram, HistogramData} from "../metric/GGHistogram.js";
import {GGMetricKey} from "../GGMetricKey.js";
import {GGMetricsExporter, ExporterConfig} from "./GGMetricsExporter.js";

export type NestedValueConverter = (metric: GGMetric<any>, value: any, exporter: GGNestedMetricsExporter) => any;

/**
 * Exports metrics in a nested, human-readable format.
 * Groups metrics by their groupBy configuration and nests remaining labels.
 */
export class GGNestedMetricsExporter extends GGMetricsExporter<NestedMetricsOutput> {

    // Static map for extensibility - register value converters for new metric types
    private static converters = new Map<Function, NestedValueConverter>();

    static {
        GGNestedMetricsExporter.registerConverter(GGCounter, convertCounterValue);
        GGNestedMetricsExporter.registerConverter(GGGauge, convertGaugeValue);
        GGNestedMetricsExporter.registerConverter(GGLazyGauge, convertLazyGaugeValue);
        GGNestedMetricsExporter.registerConverter(GGHistogram, convertHistogramValue);
    }

    /**
     * Register a value converter for a custom metric type.
     */
    static registerConverter<T extends GGMetric<any>>(
        metricClass: new (...args: any[]) => T,
        converter: (metric: T, value: any, exporter: GGNestedMetricsExporter) => any
    ): void {
        GGNestedMetricsExporter.converters.set(metricClass, converter as NestedValueConverter);
    }

    constructor(config: ExporterConfig = {}) {
        super(config);
    }

    getMetrics(): NestedMetricsOutput {
        const output: NestedMetricsOutput = {
            timestamp: Date.now(),
            groups: {}
        };

        // Collect all metric values with their parsed data
        const allValues: MetricValueEntry[] = [];

        for (const metric of this.getFilteredMetrics()) {
            const entries = this.collectMetricValues(metric);
            allValues.push(...entries);
        }

        // Group by the groupBy key
        const groupedByKey = new Map<string, MetricValueEntry[]>();
        for (const entry of allValues) {
            const existing = groupedByKey.get(entry.groupKey);
            if (existing) {
                existing.push(entry);
            } else {
                groupedByKey.set(entry.groupKey, [entry]);
            }
        }

        // Build the nested structure for each group
        for (const [groupKey, entries] of groupedByKey) {
            output.groups[groupKey] = this.buildGroupEntries(entries);
        }

        return output;
    }

    /**
     * Parse a label key string into a labels object.
     * Exposed for use by converters.
     */
    parseLabels(labelKey: string): Record<string, string> {
        if (!labelKey) return {};
        const labels: Record<string, string> = {};
        const parts = labelKey.split(',');
        for (const part of parts) {
            const [key, val] = part.split('=');
            if (key && val !== undefined) {
                labels[key] = val;
            }
        }
        return labels;
    }

    private collectMetricValues(metric: GGMetric<any>): MetricValueEntry[] {
        const entries: MetricValueEntry[] = [];
        const key = metric.key as GGMetricKey<any>;
        const groupByLabels = key.groupBy?.labels ?? [];
        const metricName = this.getShortName(key);

        for (const [labelKey, value] of metric.getValues()) {
            const labels = this.parseLabels(labelKey);

            // Compute groupBy key
            const groupKey = this.computeGroupKey(key, labels);

            // Compute remaining labels (not in groupBy)
            const remainingLabels: Record<string, string> = {};
            for (const [k, v] of Object.entries(labels)) {
                if (!groupByLabels.includes(k)) {
                    remainingLabels[k] = v;
                }
            }

            entries.push({
                groupKey,
                metricName,
                metricType: this.getMetricType(metric),
                remainingLabels,
                value: this.formatValue(metric, value)
            });
        }

        return entries;
    }

    private computeGroupKey(key: GGMetricKey<any>, labels: Record<string, string>): string {
        const groupBy = key.groupBy;
        if (!groupBy || groupBy.labels.length === 0) {
            return key.root; // Use metric root as default group
        }

        if (groupBy.template) {
            // Template string - replace {labelName} with values, missing values become empty string
            return groupBy.template.replace(/\{(\w+)\}/g, (_, labelName) => {
                return String(labels[labelName] ?? '');
            });
        } else {
            // Default: join values with comma
            return groupBy.labels.map(l => String(labels[l] ?? '')).join(',');
        }
    }

    private getShortName(key: GGMetricKey<any>): string {
        // Remove the root prefix to get just the metric name
        return key.name.replace(key.root, '');
    }

    private getMetricType(metric: GGMetric<any>): string {
        return metric.constructor.name;
    }

    private formatValue(metric: GGMetric<any>, value: any): any {
        const converter = GGNestedMetricsExporter.converters.get(metric.constructor);
        if (!converter) {
            // Fallback: return raw value
            return value;
        }
        return converter(metric, value, this);
    }

    private buildGroupEntries(entries: MetricValueEntry[]): any[] {
        // Find all unique "shared" label combinations
        // Shared labels are those that exist in multiple metrics (like 'path')
        // Non-shared labels are metric-specific (like 'result' only on counter)

        // First, find which labels are common across all metrics in this group
        const labelSets = new Map<string, Set<string>>();
        for (const entry of entries) {
            const labelNames = Object.keys(entry.remainingLabels);
            const existing = labelSets.get(entry.metricName);
            if (!existing) {
                labelSets.set(entry.metricName, new Set(labelNames));
            }
        }

        // Find common labels (present in all metrics)
        const allMetrics = [...labelSets.keys()];
        let commonLabels: Set<string> = new Set();
        if (allMetrics.length > 0) {
            commonLabels = new Set(labelSets.get(allMetrics[0])!);
            for (let i = 1; i < allMetrics.length; i++) {
                const metricLabels = labelSets.get(allMetrics[i])!;
                for (const label of commonLabels) {
                    if (!metricLabels.has(label)) {
                        commonLabels.delete(label);
                    }
                }
            }
        }

        // Group entries by their common label values
        const byCommonLabels = new Map<string, MetricValueEntry[]>();
        for (const entry of entries) {
            const commonKey = [...commonLabels]
                .sort()
                .map(l => `${l}=${entry.remainingLabels[l] ?? ''}`)
                .join(',');

            const existing = byCommonLabels.get(commonKey);
            if (existing) {
                existing.push(entry);
            } else {
                byCommonLabels.set(commonKey, [entry]);
            }
        }

        // Build output entries
        const result: any[] = [];
        for (const [_, groupEntries] of byCommonLabels) {
            const outputEntry: Record<string, any> = {};

            // Add common labels as direct properties
            if (groupEntries.length > 0) {
                for (const label of commonLabels) {
                    outputEntry[label] = groupEntries[0].remainingLabels[label];
                }
            }

            // Group entries by metric name
            const byMetric = new Map<string, MetricValueEntry[]>();
            for (const entry of groupEntries) {
                const existing = byMetric.get(entry.metricName);
                if (existing) {
                    existing.push(entry);
                } else {
                    byMetric.set(entry.metricName, [entry]);
                }
            }

            // Add each metric's values
            for (const [metricName, metricEntries] of byMetric) {
                // Get extra labels (not in commonLabels)
                const extraLabels = Object.keys(metricEntries[0].remainingLabels)
                    .filter(l => !commonLabels.has(l));

                if (extraLabels.length === 0) {
                    // No extra labels - value goes directly under metric name
                    outputEntry[metricName] = metricEntries[0].value;
                } else {
                    // Has extra labels - nest by those label names
                    this.nestByLabels(outputEntry, metricName, metricEntries, extraLabels, 0);
                }
            }

            result.push(outputEntry);
        }

        return result;
    }

    private nestByLabels(
        obj: Record<string, any>,
        metricName: string,
        entries: MetricValueEntry[],
        extraLabels: string[],
        labelIndex: number
    ): void {
        const currentLabel = extraLabels[labelIndex];
        const isLastLabel = labelIndex === extraLabels.length - 1;

        // Group entries by current label value
        const byLabelValue = new Map<string, MetricValueEntry[]>();
        for (const entry of entries) {
            const labelValue = entry.remainingLabels[currentLabel] ?? '';
            const existing = byLabelValue.get(labelValue);
            if (existing) {
                existing.push(entry);
            } else {
                byLabelValue.set(labelValue, [entry]);
            }
        }

        // Create or get the label container
        if (!obj[currentLabel]) {
            obj[currentLabel] = {};
        }
        const labelContainer = obj[currentLabel];

        // Add each label value
        for (const [labelValue, valueEntries] of byLabelValue) {
            if (isLastLabel) {
                // Last label - add metric name and value
                if (!labelContainer[labelValue]) {
                    labelContainer[labelValue] = {};
                }
                labelContainer[labelValue][metricName] = valueEntries[0].value;
            } else {
                // More labels to go - recurse
                if (!labelContainer[labelValue]) {
                    labelContainer[labelValue] = {};
                }
                this.nestByLabels(labelContainer[labelValue], metricName, valueEntries, extraLabels, labelIndex + 1);
            }
        }
    }
}

// Built-in value converters

function convertCounterValue(_metric: GGCounter<any>, value: number, _exporter: GGNestedMetricsExporter): number {
    return value;
}

function convertGaugeValue(_metric: GGGauge<any>, value: number, _exporter: GGNestedMetricsExporter): number {
    return value;
}

function convertLazyGaugeValue(_metric: GGLazyGauge, value: number, _exporter: GGNestedMetricsExporter): number {
    return value;
}

function convertHistogramValue(metric: GGHistogram<any>, value: HistogramData, _exporter: GGNestedMetricsExporter): any {
    const buckets = metric.getBuckets();
    const bucketObj: Record<string, number> = {};
    for (let i = 0; i < buckets.length; i++) {
        bucketObj[String(buckets[i])] = value.values[i] ?? 0;
    }
    return {
        count: value.count,
        sum: value.sum,
        avg: value.count > 0 ? value.sum / value.count : 0,
        min: value.min === Infinity ? 0 : value.min,
        max: value.max === -Infinity ? 0 : value.max,
        buckets: bucketObj
    };
}

// Types

interface MetricValueEntry {
    groupKey: string;
    metricName: string;
    metricType: string;
    remainingLabels: Record<string, string>;
    value: any;
}

export interface NestedMetricsOutput {
    timestamp: number;
    groups: Record<string, any[]>;
}
