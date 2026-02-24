import {GGMetricKey} from "./GGMetricKey";
import {METRICS_DEFINE_CONTEXT} from "./GGMetricsDefineStorage";

export type GGMetricsDefinition<T> = T & { __isGGMetricsDefinition: never };

export class GGMetrics {

    public static define<T>(name: string, define: () => T): GGMetricsDefinition<T> {
        return METRICS_DEFINE_CONTEXT.run(name, define) as GGMetricsDefinition<T>
    }

    public static getDefinitionContext(): string {
        return METRICS_DEFINE_CONTEXT.getStore()!
    }

    public static toJSON(metrics: GGMetricsDefinition<any>): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        this.collectKeys(metrics, result);
        return result;
    }

    private static collectKeys(obj: unknown, result: Record<string, unknown>): void {
        if (obj instanceof GGMetricKey) {
            result[obj.name] = {
                type: obj.constructor.name,
                help: obj.help
            };
        } else if (obj && typeof obj === 'object') {
            for (const value of Object.values(obj)) {
                this.collectKeys(value, result);
            }
        }
    }
}
