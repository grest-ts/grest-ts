import {GGMetric, GGMetricLabels, LabelsArgs} from "../GGMetric.js";
import type {GGGaugeKey} from "../keys/GGGaugeKey";

export class GGGauge<
    TLabels extends GGMetricLabels = {}
> extends GGMetric<TLabels, number, GGGaugeKey<TLabels>> {

    protected getDefaultValue(): number {
        return 0;
    }

    public set(value: number, ...args: LabelsArgs<TLabels>): void {
        const key = this.getKey(args[0] as TLabels);
        const current = this.getByKey(key);
        if (current === undefined) {
            return;
        }
        this.setByKey(key, value);
    }

    public inc(value: number = 1, ...args: LabelsArgs<TLabels>): void {
        const key = this.getKey(args[0] as TLabels);
        const current = this.getByKey(key);
        if (current === undefined) {
            return;
        }
        this.setByKey(key, current + value);
    }

    public dec(value: number = 1, ...args: LabelsArgs<TLabels>): void {
        const key = this.getKey(args[0] as TLabels);
        const current = this.getByKey(key);
        if (current === undefined) {
            return;
        }
        this.setByKey(key, current - value);
    }
}
