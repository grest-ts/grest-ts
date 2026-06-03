import {GGMetricKey} from "../GGMetricKey.js";
import {GGGauge} from "../metric/GGGauge.js";
import {GGMetricLabels, GGMetricOptions, LabelsArgs} from "../GGMetric.js";

export class GGGaugeKey<
    TLabels extends GGMetricLabels = {}
> extends GGMetricKey<TLabels, GGGauge<TLabels>> {

    constructor(name: string, options: GGMetricOptions<TLabels>) {
        super(name, options);
        Object.freeze(this);
    }

    public create(): GGGauge<TLabels> {
        return new GGGauge<TLabels>(this);
    }

    public set(value: number, ...args: LabelsArgs<TLabels>): void {
        this.getMetric().set(value, ...args);
    }

    public inc(value: number = 1, ...args: LabelsArgs<TLabels>): void {
        this.getMetric().inc(value, ...args);
    }

    public dec(value: number = 1, ...args: LabelsArgs<TLabels>): void {
        this.getMetric().dec(value, ...args);
    }

    public getValue(...args: LabelsArgs<TLabels>): number | undefined {
        return this.getMetric().getValue(...args);
    }

    public reset(): void {
        this.getMetric().reset();
    }
}
