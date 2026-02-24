import {GG_TEST_RUNTIME_WORKER, GGTestRuntimeWorker} from "@grest-ts/testkit";
import {IPCClient} from "@grest-ts/ipc";
import {GG_METRICS} from "../src/GGMetricsLoader.js";
import {GGCounter} from "../src/metric/GGCounter.js";
import {GGGauge} from "../src/metric/GGGauge.js";
import {GGHistogram, HistogramData, SerializedHistogramData} from "../src/metric/GGHistogram.js";

export interface MetricSnapshotRequest {
    metricName: string;
}

export interface MetricSnapshotResponse {
    name: string;
    type: string;
    help: string;
    buckets?: number[];
    values: Array<[string, number | SerializedHistogramData]>;
}

function serializeHistogramData(data: HistogramData, buckets: number[]): SerializedHistogramData {
    return {
        count: data.count,
        sum: data.sum,
        min: data.min,
        max: data.max,
        buckets: buckets,
        values: [...data.values]
    };
}

export const GGMetricsIPC = {
    worker: {
        getSnapshot: IPCClient.defineRequest<MetricSnapshotRequest, MetricSnapshotResponse | null>("metrics.getSnapshot"),
        reset: IPCClient.defineRequest<void, void>("metrics.reset"),
    }
}

GGTestRuntimeWorker.onBeforeRuntimeStart(() => {
    const worker = GG_TEST_RUNTIME_WORKER.get();

    worker.onIpcRequest(GGMetricsIPC.worker.getSnapshot, (payload) => {
        const store = GG_METRICS.tryGet();
        if (!store) return null;

        for (const metric of store.getAllMetrics()) {
            if (metric.name === payload.metricName) {
                if (metric instanceof GGCounter) {
                    const values: Array<[string, number]> = [];
                    for (const [key, value] of metric.getValues()) {
                        values.push([key, value]);
                    }
                    return {
                        name: metric.name,
                        type: 'counter',
                        help: metric.key.help,
                        values
                    };
                } else if (metric instanceof GGGauge) {
                    const values: Array<[string, number]> = [];
                    for (const [key, value] of metric.getValues()) {
                        values.push([key, value]);
                    }
                    return {
                        name: metric.name,
                        type: 'gauge',
                        help: metric.key.help,
                        values
                    };
                } else if (metric instanceof GGHistogram) {
                    const buckets = metric.getBuckets();
                    const values: Array<[string, SerializedHistogramData]> = [];
                    for (const [key, data] of metric.getValues() as Map<string, HistogramData>) {
                        values.push([key, serializeHistogramData(data, buckets)]);
                    }
                    return {
                        name: metric.name,
                        type: 'histogram',
                        help: metric.key.help,
                        buckets,
                        values
                    };
                }
            }
        }
        return null;
    });

    worker.onIpcRequest(GGMetricsIPC.worker.reset, () => {
        GG_METRICS.tryGet()?.reset();
    });
});
