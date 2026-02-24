import {GGMetrics, GGCounterKey, GGGaugeKey, GGHistogramKey} from "@grest-ts/metrics";

type RequestType = 'api' | 'internal';

export const MainMetrics = GGMetrics.define('/config_test/', () => ({
    requestCounter: new GGCounterKey<{ type: RequestType }>('requests_total', {
        help: 'Total application requests',
        labelNames: ['type']
    }),
    activeUsers: new GGGaugeKey('active_users', {
        help: 'Currently active users'
    }),
    requestDuration: new GGHistogramKey('request_duration_ms', {
        help: 'Request duration in milliseconds',
        buckets: [10, 50, 100, 250, 500, 1000]
    })
}));
