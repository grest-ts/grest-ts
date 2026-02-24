import {callOn, GGTest} from "@grest-ts/testkit";
import {MainRuntime} from "../src/main";
import {MetricsTestApi} from "../src/api/MetricsTestApi";
import {MainMetrics} from "../src/MainMetrics";

describe.shuffle("metrics with config pattern", () => {

    GGTest.startWorker(MainRuntime);
    const metricsClient = callOn(MetricsTestApi);

    beforeEach(async () => {
        await metricsClient.resetMetrics();
    });

    test('counter increments during API call', async () => {
        const before = await metricsClient.getMetrics();
        expect(before.counterValue).toBe(0);

        await metricsClient.incrementCounter({});

        const after = await metricsClient.getMetrics();
        expect(after.counterValue).toBe(1);
    });

    test('counter increments with custom delta', async () => {
        await metricsClient.incrementCounter({amount: 5});

        const response = await metricsClient.getMetrics();
        expect(response.counterValue).toBe(5);
    });

    test('gauge changes during API call', async () => {
        await metricsClient.setGauge({value: 42});

        const response = await metricsClient.getMetrics();
        expect(response.gaugeValue).toBe(42);
    });

    test('histogram records observation during API call', async () => {
        const before = await metricsClient.getMetrics();
        expect(before.histogramCount).toBe(0);

        await metricsClient.recordDuration({durationMs: 75});

        const after = await metricsClient.getMetrics();
        expect(after.histogramCount).toBe(1);
    });

    test('multiple increments tracked correctly', async () => {
        await metricsClient.incrementCounter({});
        await metricsClient.incrementCounter({amount: 2});

        const response = await metricsClient.getMetrics();
        expect(response.counterValue).toBe(3);
    });

    test('reset clears all metrics', async () => {
        await metricsClient.incrementCounter({amount: 10});
        await metricsClient.setGauge({value: 100});
        await metricsClient.recordDuration({durationMs: 50});

        await metricsClient.resetMetrics();

        const response = await metricsClient.getMetrics();
        expect(response.counterValue).toBe(0);
        expect(response.gaugeValue).toBe(0);
        expect(response.histogramCount).toBe(0);
    });
});

describe("metrics - after runtime stop", () => {

    test("metrics remain accessible after runtime.stop()", async () => {
        const t = await GGTest.startInline(MainRuntime);
        const metricsClient = callOn(MetricsTestApi);

        // Increment counter while runtime is running
        await metricsClient.incrementCounter({amount: 42});

        // Stop the runtime
        await t.stop();

        // Metrics should still be accessible via IPC after stop
        // Using the interceptor pattern to verify metrics access works
        const interceptor = t.metrics.expect(MainMetrics.requestCounter)
            .inc({type: 'api'}, 0)  // No additional increments expected
            .createInterceptor();
        await interceptor.register();  // This fetches snapshot - verifies IPC works
        await interceptor.validate();
    });
});
