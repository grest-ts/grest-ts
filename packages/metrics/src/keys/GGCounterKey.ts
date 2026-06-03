import {GGMetricKey} from "../GGMetricKey.js";
import {GGCounter} from "../metric/GGCounter.js";
import {GGMetricLabels, GGMetricOptions, LabelsArgs} from "../GGMetric.js";

export class GGCounterKey<
    TLabels extends GGMetricLabels = {}
> extends GGMetricKey<TLabels, GGCounter<TLabels>> {

    constructor(name: string, options: GGMetricOptions<TLabels>) {
        super(name, options);
        Object.freeze(this);
    }

    public create(): GGCounter<TLabels> {
        return new GGCounter<TLabels>(this);
    }

    public inc(value: number = 1, ...args: LabelsArgs<TLabels>): void {
        this.getMetric().inc(value, ...args);
    }

    public getValue(...args: LabelsArgs<TLabels>): number | undefined {
        return this.getMetric().getValue(...args);
    }

    public reset(): void {
        this.getMetric().reset();
    }
}
