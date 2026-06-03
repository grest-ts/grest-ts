import {GGMetric} from "../GGMetric.js";
import {GGCounter} from "../metric/GGCounter.js";
import {GGGauge} from "../metric/GGGauge.js";
import {GGLazyGauge} from "../metric/GGLazyGauge.js";
import {GGHistogram, HistogramData} from "../metric/GGHistogram.js";
import {GGMetricsExporter, ExporterConfig} from "./GGMetricsExporter.js";

export type JsonMetricConverter = (metric: GGMetric<any>, exporter: GGJsonMetricsExporter) => JsonMetric;

export class GGJsonMetricsExporter extends GGMetricsExporter<JsonMetricsOutput> {

    // Static map for extensibility - register converters for new metric types
    private static converters = new Map<Function, JsonMetricConverter>();

    static {
        GGJsonMetricsExporter.registerConverter(GGCounter, convertCounter);
        GGJsonMetricsExporter.registerConverter(GGGauge, convertGauge);
        GGJsonMetricsExporter.registerConverter(GGLazyGauge, convertLazyGauge);
        GGJsonMetricsExporter.registerConverter(GGHistogram, convertHistogram);
    }

    /**
     * Register a converter for a custom metric type.
     */
    static registerConverter<T extends GGMetric<any>>(
        metricClass: new (...args: any[]) => T,
        converter: (metric: T, exporter: GGJsonMetricsExporter) => JsonMetric
    ): void {
        GGJsonMetricsExporter.converters.set(metricClass, converter as JsonMetricConverter);
    }

    constructor(config: ExporterConfig = {}) {
        super(config);
    }

    getMetrics(): JsonMetricsOutput {
        const output: JsonMetricsOutput = {
            timestamp: Date.now(),
            metrics: {}
        };

        for (const metric of this.getFilteredMetrics()) {
            output.metrics[metric.name] = this.convertMetric(metric);
        }

        return output;
    }

    private convertMetric(metric: GGMetric<any>): JsonMetric {
        const converter = GGJsonMetricsExporter.converters.get(metric.constructor);
        if (!converter) {
            throw new Error(`No converter registered for metric type: ${metric.constructor.name}`);
        }
        return converter(metric, this);
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
}

// Built-in converters

function convertCounter(metric: GGCounter<any>, exporter: GGJsonMetricsExporter): JsonMetric {
    const values: JsonMetricValue[] = [];
    for (const [labelKey, value] of metric.getValues()) {
        values.push({
            labels: exporter.parseLabels(labelKey),
            value
        });
    }
    return {
        name: metric.name,
        type: 'counter',
        help: metric.key.help,
        values
    };
}

function convertGauge(metric: GGGauge<any>, exporter: GGJsonMetricsExporter): JsonMetric {
    const values: JsonMetricValue[] = [];
    for (const [labelKey, value] of metric.getValues()) {
        values.push({
            labels: exporter.parseLabels(labelKey),
            value
        });
    }
    return {
        name: metric.name,
        type: 'gauge',
        help: metric.key.help,
        values
    };
}

function convertLazyGauge(metric: GGLazyGauge, exporter: GGJsonMetricsExporter): JsonMetric {
    // Lazy gauge computes value on read - no labels
    return {
        name: metric.name,
        type: 'gauge',
        help: metric.key.help,
        values: [{
            labels: {},
            value: metric.getValue()
        }]
    };
}

function convertHistogram(metric: GGHistogram<any>, exporter: GGJsonMetricsExporter): JsonMetric {
    const values: JsonMetricValue[] = [];
    const buckets = metric.getBuckets();

    for (const [labelKey, data] of metric.getValues() as Map<string, HistogramData>) {
        const bucketObj: Record<string, number> = {};
        for (let i = 0; i < buckets.length; i++) {
            bucketObj[String(buckets[i])] = data.values[i] ?? 0;
        }

        values.push({
            labels: exporter.parseLabels(labelKey),
            value: {
                count: data.count,
                sum: data.sum,
                avg: data.count > 0 ? data.sum / data.count : 0,
                min: data.min === Infinity ? 0 : data.min,
                max: data.max === -Infinity ? 0 : data.max,
                buckets: bucketObj
            }
        });
    }

    return {
        name: metric.name,
        type: 'histogram',
        help: metric.key.help,
        values
    };
}

// Types

export interface JsonMetricValue {
    labels: Record<string, string>;
    value: number | JsonHistogramValue;
}

export interface JsonHistogramValue {
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
    buckets: Record<string, number>;
}

export interface JsonMetric {
    name: string;
    type: string;
    help: string;
    values: JsonMetricValue[];
}

export interface JsonMetricsOutput {
    timestamp: number;
    metrics: Record<string, JsonMetric>;
}
