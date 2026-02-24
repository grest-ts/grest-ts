import {GGMetricKey} from "./GGMetricKey";

/**
 * Configuration for grouping metrics in nested exporters.
 * - labels: Which labels to use for grouping (must be subset of labelNames)
 * - template: Optional template string for the group key. Use {labelName} for placeholders.
 *             Missing values become empty strings. Defaults to values.join(',')
 *             Example: "{api}.{method}" produces "MyApi.myMethod"
 */
export interface GroupByConfig<TLabels extends GGMetricLabels = {}> {
    labels: readonly (keyof TLabels & string)[];
    template?: string;
}

export interface GGMetricOptionsBase {
    help: string;
    maxLabelCombinations?: number;
}

export interface GGMetricOptionsWithLabels<TLabels extends GGMetricLabels> {
    help: string;
    maxLabelCombinations?: number;
    labelNames: readonly (keyof TLabels & string)[];
    groupBy?: GroupByConfig<TLabels>;
}

/**
 * Options for metrics. When TLabels has keys, labelNames is required and must match those keys.
 * Uses {} as "no labels" because keyof {} = never, while keyof Record<string, never> = string.
 */
export type GGMetricOptions<TLabels extends GGMetricLabels = {}> =
    keyof TLabels extends never
        ? GGMetricOptionsBase
        : GGMetricOptionsWithLabels<TLabels>;

export abstract class GGMetric<
    TLabels extends GGMetricLabels = {},
    TValue = unknown,
    TKey extends GGMetricKey<TLabels> = GGMetricKey<TLabels>
> {

    public readonly key: TKey;
    private readonly values = new Map<string, TValue>();
    private readonly compiledGetKey: (labels: TLabels) => tMetricKey;

    public constructor(key: TKey) {
        this.key = key;
        this.compiledGetKey = this.compileGetKey();
    }

    private compileGetKey(): (labels: TLabels) => tMetricKey {
        const labelNames = this.key.labelNames;
        if (labelNames.length === 0) {
            return () => '' as tMetricKey;
        }
        // Build the function body: "name1=" + (l?.name1 ?? "") + ",name2=" + (l?.name2 ?? "")
        let body = 'return ';
        for (let i = 0; i < labelNames.length; i++) {
            const name = labelNames[i];
            if (i > 0) body += '+","+';
            body += `"${name}="+(l?.${name}??"")`;
        }
        return new Function('l', body) as (labels: TLabels) => tMetricKey;
    }

    public get name(): string {
        return this.key.name;
    }

    public reset(): void {
        this.values.clear();
    }

    protected abstract getDefaultValue(): TValue;

    /**
     * Can't throw.
     * Uses AOT-compiled function for fast key generation.
     */
    protected getKey(labels: TLabels): tMetricKey {
        return this.compiledGetKey(labels);
    }

    /**
     * Can't throw.
     */
    protected getByKey(key: tMetricKey): TValue | undefined {
        const value = this.values.get(key);
        if (value === undefined) {
            if (this.values.size >= this.key.maxLabelCombinations) {
                return undefined;
            }
            const defaultValue = this.getDefaultValue();
            this.setByKey(key, defaultValue);
            return defaultValue;
        } else {
            return value;
        }
    }

    protected setByKey(key: tMetricKey, value: TValue): void {
        this.values.set(key, value);
    }

    public getValue(...args: LabelsArgs<TLabels>): TValue {
        return this.getByKey(this.getKey(args[0] as TLabels));
    }

    public getValues(): Map<string, TValue> {
        return this.values;
    }
}

export type tMetricKey = string & { tMetricKey: never };

export type GGMetricLabels = Record<string, string | number | boolean>;

/**
 * Helper type for labels parameter. Makes labels required when TLabels has keys.
 * - When TLabels = {}, no argument needed
 * - When TLabels has keys, labels argument is required
 */
export type LabelsArgs<TLabels extends GGMetricLabels> =
    keyof TLabels extends never ? [] : [labels: TLabels];
