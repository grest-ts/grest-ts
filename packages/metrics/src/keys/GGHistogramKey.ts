import {GGMetricKey} from "../GGMetricKey.js";
import {GGHistogram, HistogramData, HistogramOptions} from "../metric/GGHistogram.js";
import {GGMetricLabels, LabelsArgs} from "../GGMetric.js";

export class GGHistogramKey<
    TLabels extends GGMetricLabels = {}
> extends GGMetricKey<TLabels, GGHistogram<TLabels>> {

    public readonly buckets: number[];

    constructor(name: string, options: HistogramOptions<TLabels>) {
        super(name, options);
        this.buckets = options.buckets.sort((a, b) => a - b)
        Object.freeze(this.buckets)
        Object.freeze(this);
    }

    public create(): GGHistogram<TLabels> {
        return new GGHistogram<TLabels>(this);
    }

    public observe(value: number, ...args: LabelsArgs<TLabels>): void {
        this.getMetric().observe(value, ...args);
    }

    public startTimer(...args: LabelsArgs<TLabels>): () => void {
        return this.getMetric().startTimer(...args);
    }

    public getValue(...args: LabelsArgs<TLabels>): HistogramData | undefined {
        return this.getMetric().getValue(...args);
    }

    public reset(): void {
        this.getMetric().reset();
    }
}
