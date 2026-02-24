import {callOn, GGTest} from "@grest-ts/testkit";
import {MainRuntime} from "../src/main";
import {HttpMetricsTestApi} from "../src/api/HttpMetricsTestApi";
import {ConfigTestApi} from "../src/api/ConfigTestApi";
import {JsonHistogramValue, JsonMetric} from "@grest-ts/metrics";

describe.shuffle("GGHttp metrics", () => {

    GGTest.startWorker(MainRuntime);
    const httpMetricsClient = callOn(HttpMetricsTestApi);
    const configTestClient = callOn(ConfigTestApi);

    function parseMetrics(metricsJson: string): Record<string, JsonMetric> {
        return JSON.parse(metricsJson);
    }

    describe.shuffle("HTTP request metrics", () => {

        beforeEach(async () => {
            await httpMetricsClient.resetHttpMetrics();
        });

        test('counter increments correctly for each request', async () => {
            // Make 3 HTTP requests
            await configTestClient.logMessage({message: "test1"});
            await configTestClient.logMessage({message: "test2"});
            await configTestClient.logMessage({message: "test3"});

            const response = await httpMetricsClient.getHttpMetrics();
            const metrics = parseMetrics(response.metricsJson);

            const requestsMetric = metrics['/http/requests_total'];
            expect(requestsMetric).toBeDefined();
            expect(requestsMetric.type).toBe('counter');

            // Find the value for ConfigTestApi log endpoint
            const value = requestsMetric.values.find(v =>
                v.labels.api === 'ConfigTestApi' &&
                v.labels.method === 'log' &&
                v.labels.result === 'OK'
            );
            expect(value).toBeDefined();
            // Counter should be exactly 3
            expect(value!.value).toBe(3);
        });

        test('histogram records count, sum, and fills buckets', async () => {
            // Make multiple requests to get histogram data
            await configTestClient.logMessage({message: "test1"});
            await configTestClient.logMessage({message: "test2"});

            const response = await httpMetricsClient.getHttpMetrics();
            const metrics = parseMetrics(response.metricsJson);

            const durationMetric = metrics['/http/request_duration_ms'];
            expect(durationMetric).toBeDefined();
            expect(durationMetric.type).toBe('histogram');

            const value = durationMetric.values.find(v =>
                v.labels.api === 'ConfigTestApi' &&
                v.labels.method === 'log'
            );
            expect(value).toBeDefined();

            const histValue = value!.value as JsonHistogramValue;

            // Verify histogram structure and values
            expect(histValue.count).toBe(2); // Exactly 2 requests
            expect(histValue.sum).toBeGreaterThan(0); // Sum of durations > 0
            expect(histValue.min).toBeGreaterThan(0); // Min duration > 0
            expect(histValue.max).toBeGreaterThanOrEqual(histValue.min); // Max >= min
            expect(histValue.buckets).toBeDefined();

            // Fast requests should fall in lower buckets (< 100ms typically)
            // Check that at least one bucket has been incremented
            const bucketValues = Object.values(histValue.buckets);
            const totalInBuckets = bucketValues.reduce((a, b) => Math.max(a, b), 0);
            expect(totalInBuckets).toBeGreaterThanOrEqual(2); // At least 2 observations in some bucket

            // The highest bucket (5000ms) should contain all 2 requests
            expect(histValue.buckets['5000']).toBe(2);
        });

        test('labels are set correctly', async () => {
            await configTestClient.logMessage({message: "test"});

            const response = await httpMetricsClient.getHttpMetrics();
            const metrics = parseMetrics(response.metricsJson);

            const requestsMetric = metrics['/http/requests_total'];
            const value = requestsMetric.values.find(v =>
                v.labels.api === 'ConfigTestApi' &&
                v.labels.method === 'log'
            );
            expect(value).toBeDefined();

            // Verify all labels are present and correct
            expect(value!.labels.api).toBe('ConfigTestApi');
            expect(value!.labels.method).toBe('log'); // pathSuffix, not function name
            expect(value!.labels.path).toBe('POST /api/config-test/log'); // HTTP method + full path
            expect(value!.labels.result).toBe('OK');
        });

        test('different endpoints have separate metrics', async () => {
            // Call two different endpoints
            await configTestClient.logMessage({message: "test"});
            await configTestClient.getWatchedValue();

            const response = await httpMetricsClient.getHttpMetrics();
            const metrics = parseMetrics(response.metricsJson);

            const requestsMetric = metrics['/http/requests_total'];

            // Find log endpoint metric
            const logValue = requestsMetric.values.find(v =>
                v.labels.api === 'ConfigTestApi' &&
                v.labels.method === 'log'
            );
            expect(logValue).toBeDefined();
            expect(logValue!.value).toBe(1);

            // Find getWatchedValue endpoint metric (pathSuffix is "watched-value")
            const watchedValue = requestsMetric.values.find(v =>
                v.labels.api === 'ConfigTestApi' &&
                v.labels.method === 'watched-value'
            );
            expect(watchedValue).toBeDefined();
            expect(watchedValue!.value).toBe(1);

            // Verify they have different paths
            expect(logValue!.labels.path).not.toBe(watchedValue!.labels.path);
        });

        test('resetHttpMetrics clears all metric values', async () => {
            // Generate some metrics
            await configTestClient.logMessage({message: "test"});
            await configTestClient.logMessage({message: "test2"});

            // Verify metrics exist with correct values
            let response = await httpMetricsClient.getHttpMetrics();
            let metrics = parseMetrics(response.metricsJson);

            let logValue = metrics['/http/requests_total'].values.find(v =>
                v.labels.api === 'ConfigTestApi' &&
                v.labels.method === 'log'
            );
            expect(logValue).toBeDefined();
            expect(logValue!.value).toBe(2);

            // Reset
            await httpMetricsClient.resetHttpMetrics();

            // Verify metrics are cleared
            response = await httpMetricsClient.getHttpMetrics();
            metrics = parseMetrics(response.metricsJson);

            // After reset, the ConfigTestApi log metric should not exist
            logValue = metrics['/http/requests_total'].values.find(v =>
                v.labels.api === 'ConfigTestApi' &&
                v.labels.method === 'log'
            );
            expect(logValue).toBeUndefined();

            // Duration histogram should also be cleared
            const durationValue = metrics['/http/request_duration_ms'].values.find(v =>
                v.labels.api === 'ConfigTestApi' &&
                v.labels.method === 'log'
            );
            expect(durationValue).toBeUndefined();
        });

    });

    describe("Nested metrics exporter", () => {

        beforeEach(async () => {
            await httpMetricsClient.resetHttpMetrics();
        });

        test('groups metrics by api.method template', async () => {
            // Make requests to generate metrics
            await configTestClient.logMessage({message: "test1"});
            await configTestClient.logMessage({message: "test2"});
            await configTestClient.getWatchedValue();

            const response = await httpMetricsClient.getNestedMetrics();
            const groups = JSON.parse(response.metricsJson) as Record<string, any[]>;

            // Should have groups keyed by "{api}.{method}" template
            expect(groups['ConfigTestApi.log']).toBeDefined();
            expect(groups['ConfigTestApi.watched-value']).toBeDefined();

            // Each group should be an array
            expect(Array.isArray(groups['ConfigTestApi.log'])).toBe(true);
            expect(Array.isArray(groups['ConfigTestApi.watched-value'])).toBe(true);
        });

        test('nested output contains metrics with correct structure', async () => {
            await configTestClient.logMessage({message: "test"});

            const response = await httpMetricsClient.getNestedMetrics();
            const groups = JSON.parse(response.metricsJson) as Record<string, any[]>;

            const logGroup = groups['ConfigTestApi.log'];
            expect(logGroup).toBeDefined();
            expect(logGroup.length).toBeGreaterThan(0);

            // Check the first entry has expected metric data
            const entry = logGroup[0];

            // Should have path as a property (common across metrics)
            expect(entry.path).toBe('POST /api/config-test/log');

            // Should have histogram data (request_duration_ms without result label)
            expect(entry.request_duration_ms).toBeDefined();
            expect(entry.request_duration_ms.count).toBe(1);
            expect(entry.request_duration_ms.avg).toBeGreaterThan(0);

            // Counter has extra 'result' label, so it should be nested
            expect(entry.result).toBeDefined();
            expect(entry.result['OK']).toBeDefined();
            expect(entry.result['OK'].requests_total).toBe(1);
        });

        test('histogram includes avg field', async () => {
            await configTestClient.logMessage({message: "test1"});
            await configTestClient.logMessage({message: "test2"});

            const response = await httpMetricsClient.getNestedMetrics();
            const groups = JSON.parse(response.metricsJson) as Record<string, any[]>;

            const logGroup = groups['ConfigTestApi.log'];
            const entry = logGroup[0];

            // Histogram should have avg = sum / count
            expect(entry.request_duration_ms.count).toBe(2);
            expect(entry.request_duration_ms.sum).toBeGreaterThan(0);
            expect(entry.request_duration_ms.avg).toBe(
                entry.request_duration_ms.sum / entry.request_duration_ms.count
            );
        });

    });

});
