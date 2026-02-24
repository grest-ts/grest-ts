import {GGTestSelectorExtension, RuntimeConstructor, GGTestSelector} from "@grest-ts/testkit";
import {GGMetricKey} from "../src/GGMetricKey";
import {GGMetricsWith} from "./GGMetricsWith";
import {GGMetricsIPC} from "./GGMetricsCommands";
import {GGMetricLabels} from "../src/GGMetric";

export class GGTestSelectorMetrics extends GGTestSelectorExtension {

    public static readonly PROPERTY_NAME = "metrics"

    expect<TLabels extends GGMetricLabels>(key: GGMetricKey<TLabels>): GGMetricsWith<TLabels> {
        return new GGMetricsWith(key, this.runtimes);
    }

    async reset(): Promise<void> {
        await this.forEachParallel(async (runtime) => {
            await runtime.sendCommand(GGMetricsIPC.worker.reset, undefined);
        });
    }
}

declare module "@grest-ts/testkit" {
    interface SelectorExtensions<T extends RuntimeConstructor[]> {
        metrics: GGTestSelectorMetrics;
    }
}

GGTestSelector.addExtension(GGTestSelectorMetrics);
