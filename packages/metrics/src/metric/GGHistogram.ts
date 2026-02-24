import {GGMetric, GGMetricLabels, GGMetricOptions, LabelsArgs} from "../GGMetric.js";
import type {GGHistogramKey} from "../keys/GGHistogramKey";

export type HistogramOptions<TLabels extends GGMetricLabels = {}> =
    GGMetricOptions<TLabels> & { buckets: number[] };

export class GGHistogram<
    TLabels extends GGMetricLabels = {}
> extends GGMetric<TLabels, HistogramData, GGHistogramKey<TLabels>> {

    public getBuckets(): number[] {
        return this.key.buckets;
    }

    protected getDefaultValue(): HistogramData {
        return {
            count: 0,
            sum: 0,
            min: Infinity,
            max: -Infinity,
            values: this.key.buckets.map(() => 0)
        };
    }

    public observe(value: number, ...args: LabelsArgs<TLabels>): void {
        const key = this.getKey(args[0] as TLabels);
        const data = this.getByKey(key);
        if (data === undefined) {
            return;
        }
        data.count++;
        data.sum += value;
        if (value < data.min) {
            data.min = value;
        }
        if (value > data.max) {
            data.max = value;
        }
        for (let i = 0; i < this.key.buckets.length; i++) {
            if (value <= this.key.buckets[i]) {
                data.values[i]++;
            }
        }
    }

    public startTimer(...args: LabelsArgs<TLabels>): () => void {
        const start = Date.now();
        const labels = args[0] as TLabels;
        return () => this.observe(Date.now() - start, ...([labels] as LabelsArgs<TLabels>));
    }
}

export interface HistogramData {
    count: number;
    sum: number;
    min: number;
    max: number;
    values: number[];
}

export interface SerializedHistogramData {
    count: number;
    sum: number;
    min: number;
    max: number;
    buckets: number[];
    values: number[];
}
