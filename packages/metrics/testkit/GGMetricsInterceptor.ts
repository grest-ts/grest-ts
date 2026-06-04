import {IGGTestInterceptor} from "@grest-ts/testkit";
import {GGMetricsIPC, MetricSnapshotResponse} from "./GGMetricsCommands.js";
import type {GGTestRuntime} from "@grest-ts/testkit";
import {GGMetricLabels} from "../src/GGMetric.js";
import {HistogramData, SerializedHistogramData} from "../src/metric/GGHistogram.js";

export interface MetricExpectation<TLabels> {
    labels: TLabels;
    delta: number;
    type: 'inc' | 'incAtLeast' | 'dec' | 'observation' | 'noChange';
}

function deserializeHistogramData(data: SerializedHistogramData): HistogramData {
    return {
        count: data.count,
        sum: data.sum,
        min: data.min,
        max: data.max,
        values: [...data.values]
    };
}

function isSerializedHistogram(value: unknown): value is SerializedHistogramData {
    return typeof value === 'object' && value !== null && 'buckets' in value && 'count' in value;
}

function snapshotToMap(snapshot: MetricSnapshotResponse | null): Map<string, number | HistogramData> {
    const map = new Map<string, number | HistogramData>();
    if (!snapshot) return map;

    for (const [key, value] of snapshot.values) {
        if (isSerializedHistogram(value)) {
            map.set(key, deserializeHistogramData(value));
        } else {
            map.set(key, value);
        }
    }
    return map;
}

export class GGMetricsInterceptor<TLabels extends GGMetricLabels> implements IGGTestInterceptor {
    private beforeSnapshot: Map<string, number | HistogramData> = new Map();
    private validationError: Error | undefined;
    private wasRegistered = false;
    private readonly metricName: string
    private readonly labelNames: readonly string[]
    private readonly runtimes: GGTestRuntime[]
    private readonly expectations: MetricExpectation<TLabels>[]
    private readonly noChangeExpected: boolean
    private readonly definedInSourceFile: string

    constructor(
        metricName: string,
        labelNames: readonly string[],
        runtimes: GGTestRuntime[],
        expectations: MetricExpectation<TLabels>[],
        noChangeExpected: boolean,
        definedInSourceFile: string
    ) {
        this.metricName = metricName
        this.labelNames = labelNames
        this.runtimes = runtimes
        this.expectations = expectations
        this.noChangeExpected = noChangeExpected
        this.definedInSourceFile = definedInSourceFile
    }

    async register(): Promise<void> {
        this.wasRegistered = true;
        const snapshots = await this.getSnapshotsFromRuntimes();
        this.beforeSnapshot = this.mergeSnapshots(snapshots);
    }

    unregister(): void {}

    async validate(): Promise<void> {
        const afterSnapshots = await this.getSnapshotsFromRuntimes();
        const after = this.mergeSnapshots(afterSnapshots);

        try {
            if (this.noChangeExpected) {
                this.validateNoChange(this.beforeSnapshot, after);
            }

            for (const expectation of this.expectations) {
                this.validateExpectation(expectation, this.beforeSnapshot, after);
            }
        } catch (e: unknown) {
            this.validationError = e instanceof Error ? e : new Error(String(e));
            throw this.validationError;
        }
    }

    private async getSnapshotsFromRuntimes(): Promise<MetricSnapshotResponse[]> {
        const results: MetricSnapshotResponse[] = [];

        await Promise.all(
            this.runtimes.map(async (runtime) => {
                const snapshot = await runtime.sendCommand(
                    GGMetricsIPC.worker.getSnapshot,
                    { metricName: this.metricName }
                );
                if (snapshot) {
                    results.push(snapshot);
                }
            })
        );

        return results;
    }

    private mergeSnapshots(snapshots: MetricSnapshotResponse[]): Map<string, number | HistogramData> {
        const merged = new Map<string, number | HistogramData>();

        for (const snapshot of snapshots) {
            const map = snapshotToMap(snapshot);
            for (const [key, value] of map) {
                const existing = merged.get(key);
                if (existing === undefined) {
                    merged.set(key, value);
                } else if (typeof existing === 'number' && typeof value === 'number') {
                    merged.set(key, existing + value);
                } else if (typeof existing === 'object' && typeof value === 'object') {
                    merged.set(key, {
                        count: existing.count + value.count,
                        sum: existing.sum + value.sum,
                        min: Math.min(existing.min, value.min),
                        max: Math.max(existing.max, value.max),
                        values: this.mergeValues(existing.values, value.values)
                    });
                }
            }
        }

        return merged;
    }

    private mergeValues(a: number[], b: number[]): number[] {
        const result: number[] = [];
        const len = Math.max(a.length, b.length);
        for (let i = 0; i < len; i++) {
            result.push((a[i] ?? 0) + (b[i] ?? 0));
        }
        return result;
    }

    private validateNoChange(before: Map<string, number | HistogramData>, after: Map<string, number | HistogramData>): void {
        for (const [key, beforeVal] of before) {
            const afterVal = after.get(key);
            if (!this.valuesEqual(beforeVal, afterVal)) {
                throw new Error(
                    `[Metrics Test Failed] Expected no change in metric "${this.metricName}" ` +
                    `but {${key}} changed\n\t${this.definedInSourceFile}`
                );
            }
        }

        for (const key of after.keys()) {
            if (!before.has(key)) {
                throw new Error(
                    `[Metrics Test Failed] Expected no change in metric "${this.metricName}" ` +
                    `but new label combination {${key}} appeared\n\t${this.definedInSourceFile}`
                );
            }
        }
    }

    private validateExpectation(
        exp: MetricExpectation<TLabels>,
        before: Map<string, number | HistogramData>,
        after: Map<string, number | HistogramData>
    ): void {
        const key = this.labelsToKey(exp.labels);
        const beforeVal = before.get(key);
        const afterVal = after.get(key);

        switch (exp.type) {
            case 'inc':
            case 'dec': {
                const beforeNum = typeof beforeVal === 'number' ? beforeVal : 0;
                const afterNum = typeof afterVal === 'number' ? afterVal : 0;
                const actualDelta = afterNum - beforeNum;

                if (actualDelta !== exp.delta) {
                    throw new Error(
                        `[Metrics Test Failed] Expected metric "${this.metricName}" {${key || '(no labels)'}} ` +
                        `to change by ${exp.delta}, but actual delta was ${actualDelta}\n\t${this.definedInSourceFile}`
                    );
                }
                break;
            }

            case 'incAtLeast': {
                const beforeNum = typeof beforeVal === 'number' ? beforeVal : 0;
                const afterNum = typeof afterVal === 'number' ? afterVal : 0;
                const actualDelta = afterNum - beforeNum;

                if (actualDelta < exp.delta) {
                    throw new Error(
                        `[Metrics Test Failed] Expected metric "${this.metricName}" {${key || '(no labels)'}} ` +
                        `to change by at least ${exp.delta}, but actual delta was ${actualDelta}\n\t${this.definedInSourceFile}`
                    );
                }
                break;
            }

            case 'observation': {
                const beforeCount = this.getCount(beforeVal);
                const afterCount = this.getCount(afterVal);

                if (afterCount <= beforeCount) {
                    throw new Error(
                        `[Metrics Test Failed] Expected observation in metric "${this.metricName}" {${key || '(no labels)'}} ` +
                        `but count did not increase\n\t${this.definedInSourceFile}`
                    );
                }
                break;
            }

            case 'noChange': {
                if (!this.valuesEqual(beforeVal, afterVal)) {
                    throw new Error(
                        `[Metrics Test Failed] Expected no change for metric "${this.metricName}" {${key || '(no labels)'}} ` +
                        `but value changed\n\t${this.definedInSourceFile}`
                    );
                }
                break;
            }
        }
    }

    private getCount(val: number | HistogramData | undefined): number {
        if (val === undefined) return 0;
        if (typeof val === 'number') return val;
        return val.count;
    }

    private valuesEqual(a: number | HistogramData | undefined, b: number | HistogramData | undefined): boolean {
        if (a === b) return true;
        if (typeof a === 'number' && typeof b === 'number') return a === b;
        if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
            return a.count === b.count && a.sum === b.sum;
        }
        return false;
    }

    private labelsToKey(labels: TLabels): string {
        if (!labels || Object.keys(labels).length === 0) return '';
        // Use the same order as the metric's labelNames
        return this.labelNames
            .map(name => `${name}=${labels[name] ?? ''}`)
            .join(',');
    }

    getMockValidationError(): Error | undefined {
        return this.validationError;
    }

    isCalled(): boolean {
        return this.wasRegistered;
    }
}
