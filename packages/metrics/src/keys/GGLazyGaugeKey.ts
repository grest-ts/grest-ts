import {GGMetricKey} from "../GGMetricKey.js";
import {GGLazyGauge} from "../metric/GGLazyGauge.js";
import {GGMetricOptionsBase} from "../GGMetric.js";

export interface LazyGaugeOptions extends GGMetricOptionsBase {
    getValue: () => number;
}

/**
 * Key for a lazy gauge metric.
 * The getValue function is called whenever the metric value is read.
 */
export class GGLazyGaugeKey extends GGMetricKey<{}, GGLazyGauge> {

    public declare readonly options: LazyGaugeOptions;

    constructor(name: string, options: LazyGaugeOptions) {
        super(name, options);
        Object.freeze(this);
    }

    public create(): GGLazyGauge {
        return new GGLazyGauge(this);
    }

    /**
     * Get the current value by calling the getValue function.
     */
    public getValue(): number {
        return this.getMetric().getValue();
    }

    public reset(): void {
        // No-op for lazy gauge - nothing to reset
    }
}
