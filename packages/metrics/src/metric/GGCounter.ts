import {GGMetric, GGMetricLabels, LabelsArgs} from "../GGMetric.js";
import type {GGCounterKey} from "../keys/GGCounterKey";

export class GGCounter<
    TLabels extends GGMetricLabels = {}
> extends GGMetric<TLabels, number, GGCounterKey<TLabels>> {

    protected getDefaultValue(): number {
        return 0;
    }

    public inc(value: number = 1, ...args: LabelsArgs<TLabels>): void {
        const key = this.getKey(args[0] as TLabels);
        const current = this.getByKey(key);
        if (current !== undefined) {
            this.setByKey(key, current + value);
        }
    }
}
