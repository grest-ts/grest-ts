import {callOn, GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit";
import {MainRuntime} from "../src/main";
import {MainConfigApi} from "../src/MainConfig.api";
import {ConfigTestApi} from "../src/api/ConfigTestApi";
import {ConfigTestSocketApi} from "../src/api/ConfigTestSocketApi";

describe("dynamic config", () => {

    const t = GGTest.startWorker(MainRuntime);
    const httpClient = callOn(ConfigTestApi);

    describe("HTTP test", () => {
        test('service can read initial config value', async () => {
            const response = await httpClient.getWatchedValue();
            expect(typeof response.watchedTimeout).toBe('number');
        })

        test('config watch updates local variable on change', async () => {
            // Get initial watched value from ConfigTestService
            const initialResponse = await httpClient.getWatchedValue();
            const initialWatchedTimeout = initialResponse.watchedTimeout;

            // Update config at runtime
            const newTimeout = initialWatchedTimeout === 10000 ? 30000 : 10000;
            await t.config.update(MainConfigApi.settings.timeout, newTimeout);

            // Verify the watched value was updated via the watch callback
            const updatedResponse = await httpClient.getWatchedValue();
            expect(updatedResponse.watchedTimeout).toBe(newTimeout);
        })

        test('config value persists across multiple updates', async () => {
            // First update
            await t.config.update(MainConfigApi.settings.timeout, 1000);
            let response = await httpClient.getWatchedValue();
            expect(response.watchedTimeout).toBe(1000);

            // Second update
            await t.config.update(MainConfigApi.settings.timeout, 2000);
            response = await httpClient.getWatchedValue();
            expect(response.watchedTimeout).toBe(2000);

            // Third update
            await t.config.update(MainConfigApi.settings.timeout, 3000);
            response = await httpClient.getWatchedValue();
            expect(response.watchedTimeout).toBe(3000);
        })

        test('config update produces log message', async () => {
            // Config update action can use .with() to check for logs
            await t.config.update(MainConfigApi.settings.timeout, 9999)
                .with(t.logs.expect({
                    contextName: "ConfigTestService",
                    message: "Config timeout changed"
                }));

            // Verify the value was actually updated
            const response = await httpClient.getWatchedValue();
            expect(response.watchedTimeout).toBe(9999);
        })
    });

    describe("WebSocket", () => {

        // Reuse runtime from parent describe - don't create a second runtime
        // Having two runtimes causes routing issues (roundRobin alternates between them)
        const socketClient = callOn(ConfigTestSocketApi);

        beforeAll(async () => {
            await socketClient.connect();
        })

        test('socket can read config value', async () => {
            // Reset to known default value first - expect configChanged notification
            await t.config.update(MainConfigApi.settings.timeout, 5000)
                .with(socketClient.mock.configChanged.toMatchObject({watchedTimeout: 5000}));

            const response = await socketClient.getWatchedValue();
            expect(response.watchedTimeout).toBe(5000);
        })

        test('socket receives config change notification', async () => {
            // Update config and verify socket receives notification
            await t.config.update(MainConfigApi.settings.timeout, 7777)
                .with(socketClient.mock.configChanged.toMatchObject({watchedTimeout: 7777}));
        })

        test('socket config updates work across multiple changes', async () => {
            // First update - expect notification
            await t.config.update(MainConfigApi.settings.timeout, 1111)
                .with(socketClient.mock.configChanged.toMatchObject({watchedTimeout: 1111}));
            let response = await socketClient.getWatchedValue();
            expect(response.watchedTimeout).toBe(1111);

            // Second update - expect notification
            await t.config.update(MainConfigApi.settings.timeout, 2222)
                .with(socketClient.mock.configChanged.toMatchObject({watchedTimeout: 2222}));
            response = await socketClient.getWatchedValue();
            expect(response.watchedTimeout).toBe(2222);
        })
    })

    describe("WebSocket createClient (production)", () => {

        test('production client can call outgoing and receive incoming', async () => {
            const url = GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl("ConfigTestSocketApi");
            const client = ConfigTestSocketApi.createClient({url});

            let receivedValue: number | undefined;
            client.incoming.on({
                configChanged: (msg) => {
                    receivedValue = msg.watchedTimeout;
                }
            });

            try {
                await client.connect();

                await t.config.update(MainConfigApi.settings.timeout, 4242);

                const response = await client.outgoing.getWatchedValue();
                expect(response.watchedTimeout).toBe(4242);

                // Wait briefly for the server-pushed configChanged event
                await new Promise(resolve => setTimeout(resolve, 50));
                expect(receivedValue).toBe(4242);
            } finally {
                await client.disconnect();
            }
        });
    })

})

describe("config - after runtime stop", () => {

    test("config remains accessible after runtime.stop()", async () => {
        const t = await GGTest.startInline(MainRuntime);

        // Set a config value while runtime is running
        await t.config.update(MainConfigApi.settings.timeout, 12345);

        // Stop the runtime
        await t.stop();

        // Config should still be readable via IPC after stop
        const value = await t.config.get(MainConfigApi.settings.timeout);
        expect(value).toBe(12345);
    });
})
