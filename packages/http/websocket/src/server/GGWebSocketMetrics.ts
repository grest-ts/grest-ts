import {GGCounterKey, GGGaugeKey, GGHistogramKey, GGMetrics} from "@grest-ts/metrics";
import {EXISTS, FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND, OK, ROUTE_NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema";

/**
 * Result type for WebSocket operations.
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

type SocketConnectionResult = 'OK' | 'AUTH_FAILED' | 'QUERY_INVALID' | string;

export const GGWebSocketMetrics = GGMetrics.define('/websocket/', () => ({
    connectionsActive: new GGGaugeKey<{ api: string, path: string }>('connections_active', {
        help: 'Active WebSocket connections',
        labelNames: ['api', 'path'],
        groupBy: {labels: ["api"]}
    }),
    connections: new GGCounterKey<{ api: string, path: string, result: SocketConnectionResult }>('connections_total', {
        help: 'Total WebSocket connection attempts',
        labelNames: ['api', 'path', 'result'],
        groupBy: {labels: ["api"]}
    }),
    heartbeatTimeouts: new GGCounterKey<{ api: string, path: string }>('heartbeat_timeouts_total', {
        help: 'Connections closed because no heartbeat response arrived within the deadline',
        labelNames: ['api', 'path'],
        groupBy: {labels: ["api"]}
    }),

    // Incoming (server handling REQ + MSG)
    requests: new GGCounterKey<{ api: string, path: string, method: string, result: ResultType }>('requests_total', {
        help: 'Total incoming WebSocket commands (REQ + MSG)',
        labelNames: ['api', 'path', 'method', 'result'],
        groupBy: {labels: ["api", "method"], template: "{api}.{method}"}
    }),
    requestDuration: new GGHistogramKey<{ api: string, path: string, method: string }>('request_duration_ms', {
        help: 'Incoming WebSocket command processing duration in milliseconds',
        labelNames: ['api', 'path', 'method'],
        buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
        groupBy: {labels: ["api", "method"], template: "{api}.{method}"}
    }),

    // Outgoing (client calls via socket)
    outRequests: new GGCounterKey<{ api: string, path: string, method: string, result: ResultType }>('out_requests_total', {
        help: 'Total outgoing WebSocket commands (REQ + MSG)',
        labelNames: ['api', 'path', 'method', 'result'],
        groupBy: {labels: ["api", "method"], template: "{api}.{method}"}
    }),
    outRequestDuration: new GGHistogramKey<{ api: string, path: string, method: string }>('out_request_duration_ms', {
        help: 'Outgoing WebSocket request round-trip duration in milliseconds (REQ only)',
        labelNames: ['api', 'path', 'method'],
        buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500],
        groupBy: {labels: ["api", "method"], template: "{api}.{method}"}
    }),
}));
