import {GGMetrics} from "./GGMetrics.js";
import {GG_METRICS} from "./GGMetricsLoader.js";
import {GGMetric, GGMetricLabels, GGMetricOptions, GroupByConfig} from "./GGMetric.js";

export abstract class GGMetricKey<
    TLabels extends GGMetricLabels = {},
    TMetric extends GGMetric<TLabels, any, any> = GGMetric<TLabels, any, any>
> {

    public readonly root: string;
    public readonly name: string;
    public readonly help: string;
    public readonly labelNames: readonly string[];
    public readonly maxLabelCombinations?: number;
    public readonly groupBy?: GroupByConfig<TLabels>;

    protected constructor(name: string, options: GGMetricOptions<TLabels>) {
        this.root = GGMetrics.getDefinitionContext();
        if (!this.root) {
            throw new Error("Metric key must be created inside GGMetrics.define()");
        }
        this.name = this.root + name;
        this.help = options.help;
        this.labelNames = ('labelNames' in options ? options.labelNames : []) as readonly (keyof TLabels & string)[];
        this.maxLabelCombinations = options.maxLabelCombinations;
        this.groupBy = ('groupBy' in options ? options.groupBy : undefined) as GroupByConfig<TLabels> | undefined;
        Object.freeze(this.labelNames);
        if (this.groupBy) {
            Object.freeze(this.groupBy.labels);
        }
    }

    protected getMetric(): TMetric {
        return GG_METRICS.get().get(this) as TMetric;
    }

    public abstract create(): TMetric;
}
