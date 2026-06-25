import {HttpMetricsResponse, HttpMetricsTestApiContract} from "../api/HttpMetricsTestApi";
import {GGHttpMetrics} from "@grest-ts/http";
import {GGJsonMetricsExporter, GGNestedMetricsExporter} from "@grest-ts/metrics";
import {GGWebSocketMetrics} from "@grest-ts/websocket";

type IHttpMetricsTestApi = typeof HttpMetricsTestApiContract.infer

export class HttpMetricsTestService implements IHttpMetricsTestApi {

    async getHttpMetrics(): Promise<HttpMetricsResponse> {
        // New API: config object, store defaults to async context
        const exporter = new GGJsonMetricsExporter({});
        const metrics = exporter.getMetrics();
        return {
            timestamp: metrics.timestamp,
            metricsJson: JSON.stringify(metrics.metrics)
        };
    }

    async getNestedMetrics(): Promise<HttpMetricsResponse> {
        // New API: config object, store defaults to async context
        const exporter = new GGNestedMetricsExporter({});
        const metrics = exporter.getMetrics();
        return {
            timestamp: metrics.timestamp,
            metricsJson: JSON.stringify(metrics.groups)
        };
    }

    async resetHttpMetrics(): Promise<{ reset: boolean }> {
        GGHttpMetrics.requests.reset();
        GGHttpMetrics.requestDuration.reset();
        GGWebSocketMetrics.connections.reset();
        GGWebSocketMetrics.connectionsActive.reset();
        GGWebSocketMetrics.requests.reset();
        GGWebSocketMetrics.requestDuration.reset();
        GGWebSocketMetrics.outRequests.reset();
        GGWebSocketMetrics.outRequestDuration.reset();
        return {reset: true};
    }
}
