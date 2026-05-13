## Custom Metric Types

Create new metric types by extending `GGMetric` and `GGMetricKey`:

```typescript
import {GGMetric, GGMetricKey, GGMetricLabels, GGMetricOptions, LabelsArgs} from "@grest-ts/metrics"

// 1. Metric class - stores values
export class GGMaxGauge<
    TLabels extends GGMetricLabels = {}
> extends GGMetric<TLabels, number, GGMaxGaugeKey<TLabels>> {

    protected getDefaultValue(): number {
        return 0;
    }

    public set(value: number, ...args: LabelsArgs<TLabels>): void {
        const key = this.getKey(args[0] as TLabels);
        const current = this.getByKey(key) ?? 0;
        if (value > current) {
            this.setByKey(key, value);
        }
    }
}

// 2. Key class - defines and exposes API
export class GGMaxGaugeKey<
    TLabels extends GGMetricLabels = {}
> extends GGMetricKey<TLabels, GGMaxGauge<TLabels>> {

    constructor(name: string, options: GGMetricOptions<TLabels>) {
        super(name, options);
        Object.freeze(this);
    }

    public create(): GGMaxGauge<TLabels> {
        return new GGMaxGauge<TLabels>(this);
    }

    public set(value: number, ...args: LabelsArgs<TLabels>): void {
        this.getMetric().set(value, ...args);
    }
}
```

Usage:

```typescript
export const AppMetrics = GGMetrics.define('/app/', () => ({
    peakMemory: new GGMaxGaugeKey('peak_memory_bytes', {
        help: 'Peak memory usage'
    })
}));

AppMetrics.peakMemory.set(1000);
AppMetrics.peakMemory.set(500);  // ignored, lower than current
AppMetrics.peakMemory.set(2000); // updates to 2000
```

## Custom Converters

Register converters for custom metric types with built-in exporters:

```typescript
import {GGJsonMetricsExporter, GGNestedMetricsExporter} from "@grest-ts/metrics"

// For JSON exporter
GGJsonMetricsExporter.registerConverter(MyCustomMetric, (metric, exporter) => {
    return {
        name: metric.name,
        type: 'custom',
        help: metric.key.help,
        values: [{
            labels: {},
            value: metric.getValue()
        }]
    };
});

// For nested exporter
GGNestedMetricsExporter.registerConverter(MyCustomMetric, (metric, value, exporter) => {
    return value;
});
```

## Custom Exporters

Extend `GGMetricsExporter` to create custom export formats:

```typescript
import {GGMetricsExporter, ExporterConfig} from "@grest-ts/metrics"

export class MyCustomExporter extends GGMetricsExporter<MyOutputFormat> {
    constructor(config: ExporterConfig = {}) {
        super(config);
    }

    getMetrics(): MyOutputFormat {
        const output: MyOutputFormat = {
            timestamp: Date.now(),
            data: []
        };

        for (const metric of this.getFilteredMetrics()) {
            // Send to external service or format as needed
            output.data.push({
                name: metric.name,
                type: metric.constructor.name,
                values: [...metric.getValues()]
            });
        }

        return output;
    }
}

// Usage
const exporter = new MyCustomExporter();
const metrics = exporter.getMetrics();
```
