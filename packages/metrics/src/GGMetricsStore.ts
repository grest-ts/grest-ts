import {GGMetric, GGMetricLabels} from "./GGMetric.js";
import {GGMetricKey} from "./GGMetricKey.js";

export class GGMetricsStore {

    private readonly metrics = new Map<string, GGMetric<any>>();

    public get<TLabel extends GGMetricLabels>(key: GGMetricKey<TLabel>): GGMetric<TLabel> {
        let metric = this.metrics.get(key.name);
        if (!metric) {
            metric = key.create();
            this.metrics.set(key.name, metric);
        }
        return metric;
    }

    public getAllMetrics(): IterableIterator<GGMetric<any>> {
        return this.metrics.values();
    }

    public reset(): void {
        for (const metric of this.metrics.values()) {
            metric.reset();
        }
    }
}
