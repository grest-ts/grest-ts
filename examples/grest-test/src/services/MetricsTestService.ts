import {IMetricsTestApi, MetricsResponse, IncrementRequest} from "../api/MetricsTestApi";
import {MainMetrics} from "../MainMetrics";

export class MetricsTestService implements IMetricsTestApi {

    async getMetrics(): Promise<MetricsResponse> {
        return {
            success: true,
            counterValue: MainMetrics.requestCounter.getValue({ type: 'api' }) ?? 0,
            gaugeValue: MainMetrics.activeUsers.getValue() ?? 0,
            histogramCount: MainMetrics.requestDuration.getValue()?.count ?? 0
        };
    }

    async incrementCounter(request: IncrementRequest): Promise<MetricsResponse> {
        MainMetrics.requestCounter.inc(request.amount ?? 1, { type: 'api' });
        return this.getMetrics();
    }

    async setGauge(request: { value: number }): Promise<MetricsResponse> {
        MainMetrics.activeUsers.set(request.value);
        return this.getMetrics();
    }

    async recordDuration(request: { durationMs: number }): Promise<MetricsResponse> {
        MainMetrics.requestDuration.observe(request.durationMs);
        return this.getMetrics();
    }

    async resetMetrics(): Promise<{ reset: boolean }> {
        MainMetrics.requestCounter.reset();
        MainMetrics.activeUsers.reset();
        MainMetrics.requestDuration.reset();
        return { reset: true };
    }
}
