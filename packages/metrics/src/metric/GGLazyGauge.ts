import {GGMetric} from "../GGMetric.js";
import type {GGLazyGaugeKey} from "../keys/GGLazyGaugeKey";

/**
 * A gauge that computes its value lazily by calling a function.
 * Perfect for "current state" metrics like memory usage, active handles, etc.
 * Does not support labels - use regular GGGauge if you need labels.
 */
export class GGLazyGauge extends GGMetric<{}, number, GGLazyGaugeKey> {

    protected getDefaultValue(): number {
        return 0;
    }

    /**
     * Get the current value by calling the getValue function.
     */
    public getValue(): number {
        return this.key.options.getValue();
    }

    /**
     * Returns a map with single entry (empty key -> current value).
     * Compatible with exporter iteration pattern.
     */
    public getValues(): Map<string, number> {
        const map = new Map<string, number>();
        map.set('', this.getValue());
        return map;
    }
}
