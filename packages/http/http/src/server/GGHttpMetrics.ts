import {GGCounterKey, GGHistogramKey, GGMetrics} from "@grest-ts/metrics";
import {EXISTS, FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND, OK, ROUTE_NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema";

/**
 * Result type for HTTP operations.
 * Known types listed for documentation, but accepts any string for custom error types.
 */
type ResultType =
    | typeof OK.TYPE
    | typeof VALIDATION_ERROR.TYPE
    | typeof NOT_AUTHORIZED.TYPE
    | typeof FORBIDDEN.TYPE
    | typeof NOT_FOUND.TYPE
    | typeof ROUTE_NOT_FOUND.TYPE
    | typeof EXISTS.TYPE
    | typeof SERVER_ERROR.TYPE
    | string;

export const GGHttpMetrics = GGMetrics.define('/http/', () => ({
    requests: new GGCounterKey<{ api: string, method: string, path: string, result: ResultType }>('requests_total', {
        help: 'Total HTTP requests after contract validation',
        labelNames: ['api', 'method', 'path', 'result'],
        groupBy: {labels: ["api", "method"], template: "{api}.{method}"}
    }),
    requestDuration: new GGHistogramKey<{ api: string, method: string, path: string }>('request_duration_ms', {
        help: 'HTTP request duration in milliseconds',
        labelNames: ['api', 'method', 'path'],
        buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
        groupBy: {labels: ["api", "method"], template: "{api}.{method}"}
    }),
}));
