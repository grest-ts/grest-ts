import type {GGTestRuntime} from "@grest-ts/testkit";
import {IGGTestWith} from "@grest-ts/testkit";
import {GGMetricKey} from "../src/GGMetricKey";
import {GGMetricsInterceptor, MetricExpectation} from "./GGMetricsInterceptor";
import {GGMetricLabels} from "../src/GGMetric";

function captureStackSourceFile(): string {
    const stack = new Error().stack ?? '';
    const lines = stack.split('\n');
    for (let i = 2; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes('GGMetricsWith') && !line.includes('GGCounter') &&
            !line.includes('GGGauge') && !line.includes('GGHistogram') &&
            !line.includes('GGMetricKey') && !line.includes('GGTestSelectorMetrics')) {
            const match = line.match(/at\s+(.+)/);
            if (match) return match[1].trim();
        }
    }
    return '';
}

export class GGMetricsWith<TLabels extends GGMetricLabels> implements IGGTestWith {
    private readonly expectations: MetricExpectation<TLabels>[] = [];
    private noChangeExpected = false;
    private readonly definedInSourceFile: string;
    private readonly metricName: string;
    private readonly labelNames: readonly string[];
    private readonly runtimes: GGTestRuntime[];

    constructor(metricKey: GGMetricKey<TLabels>, runtimes: GGTestRuntime[]) {
        this.metricName = metricKey.name;
        this.labelNames = metricKey.labelNames;
        this.runtimes = runtimes;
        this.definedInSourceFile = captureStackSourceFile();
        if (this.runtimes.length > 1) {
            throw new Error("Can only apply Metrics actions on one runtime. Make your selection more precise!");
        }
    }

    inc(labels: TLabels, delta: number = 1): this {
        this.expectations.push({labels, delta, type: 'inc'});
        return this;
    }

    incAtLeast(labels: TLabels, delta: number = 1): this {
        this.expectations.push({labels, delta, type: 'incAtLeast'});
        return this;
    }

    dec(labels: TLabels, delta: number = 1): this {
        this.expectations.push({labels, delta: -delta, type: 'dec'});
        return this;
    }

    observation(labels: TLabels): this {
        this.expectations.push({labels, delta: 0, type: 'observation'});
        return this;
    }

    noChange(): this {
        this.noChangeExpected = true;
        return this;
    }

    noChangeFor(labels: TLabels): this {
        this.expectations.push({labels, delta: 0, type: 'noChange'});
        return this;
    }

    createInterceptor(): GGMetricsInterceptor<TLabels> {
        return new GGMetricsInterceptor(
            this.metricName,
            this.labelNames,
            this.runtimes,
            this.expectations,
            this.noChangeExpected,
            this.definedInSourceFile
        );
    }
}
