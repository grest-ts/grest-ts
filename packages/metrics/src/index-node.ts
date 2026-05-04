import "./_dedupCheck";
import {AsyncLocalStorage} from "node:async_hooks";
import {_initMetricsStorage} from "./GGMetricsDefineStorage";
_initMetricsStorage(new AsyncLocalStorage());

export * from './GGMetric';
export * from './metric/GGCounter';
export * from './metric/GGGauge';
export * from './metric/GGLazyGauge';
export * from './metric/GGHistogram';
export * from './GGMetrics';
export * from './GGMetricsLoader';
export * from "./GGMetricKey";
export * from "./keys/GGCounterKey";
export * from "./keys/GGGaugeKey";
export * from "./keys/GGLazyGaugeKey";
export * from "./keys/GGHistogramKey";
export * from './exporters/GGMetricsExporter';
export * from './exporters/GGJsonMetricsExporter';
export * from './exporters/GGNestedMetricsExporter';
export * from "./GGMetricsStore";

