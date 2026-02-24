import {GGTest} from "@grest-ts/testkit";
import {GGLog} from "@grest-ts/logger";
import {GGLocator, GGLocatorKey, GGLocatorServiceType} from "@grest-ts/locator";
import {GGRuntime} from "@grest-ts/runtime";
import {GGMetricsLoader} from "@grest-ts/metrics";

export class LifecycleService {
    constructor(
        public readonly name: string,
        public readonly priority: GGLocatorServiceType,
        private readonly shouldFail: boolean = false
    ) {
        GGLocator.getScope().setWithLifecycle(
            new GGLocatorKey<LifecycleService>(`LifecycleService-${name}`),
            this,
            {
                type: priority,
                start: async () => {
                    GGLog.info(this, `LIFECYCLE:START:${name}:P${priority}`);
                    if (this.shouldFail) {
                        throw new Error(`LifecycleService-${name} failed to start (This is expected test behavior, not real error!)`);
                    }
                },
                teardown: async () => {
                    GGLog.info(this, `LIFECYCLE:STOP:${name}:P${priority}`);
                }
            }
        );
    }
}

export class LifecycleTestRuntime extends GGRuntime {
    public static readonly NAME = "lifecycle"
    public static readonly SOURCE_MODULE_URL = import.meta.url

    constructor(private readonly failServiceLetter?: "A" | "B" | "C" | "D") {
        super();
    }

    protected compose(): void {
        new GGMetricsLoader();
        new LifecycleService("A", GGLocatorServiceType.CONFIG, this.failServiceLetter === "A");    // P0
        new LifecycleService("B", GGLocatorServiceType.DATABASE, this.failServiceLetter === "B");  // P10
        new LifecycleService("C", GGLocatorServiceType.HTTP, this.failServiceLetter === "C");      // P20
        new LifecycleService("D", GGLocatorServiceType.BUSINESS, this.failServiceLetter === "D");  // P30
    }
}

export class FailingLifecycleTestRuntime extends LifecycleTestRuntime {
    public static readonly NAME = "lifecycle"
    public static readonly SOURCE_MODULE_URL = import.meta.url

    constructor() {
        super("C");
    }
}

describe("lifecycle - startup and shutdown order", () => {

    test("success path - startup, shutdown, and log accessibility", async () => {
        const t = await GGTest.startInline(LifecycleTestRuntime);

        // Verify startup order
        const startupLogs = await t.logs.fromStart().retrieve();
        const startMessages = startupLogs.map(l => l.message);

        // Runtime lifecycle messages
        // expect(startMessages).toContainEqual("Runtime starting");
        // expect(startMessages).toContainEqual("Composing services...");
        expect(startMessages).toContainEqual("Starting...");
        expect(startMessages).toContainEqual("Runtime running");

        // Services start in priority order
        const startLogs = startupLogs
            .filter(l => l.message?.startsWith("LIFECYCLE:START:"))
            .map(l => l.message);
        expect(startLogs).toEqual([
            "LIFECYCLE:START:A:P0",
            "LIFECYCLE:START:B:P10",
            "LIFECYCLE:START:C:P20",
            "LIFECYCLE:START:D:P30",
        ]);

        // Stop runtime
        await t.stop();

        // Logs accessible after stop
        const allLogs = await t.logs.fromStart().retrieve();
        const allMessages = allLogs.map(l => l.message);

        // Shutdown lifecycle messages captured
        expect(allMessages).toContainEqual("Gracefully shutting down");
        expect(allMessages).toContainEqual("Shutdown complete");

        // Services stop in reverse priority order
        const stopLogs = allLogs
            .filter(l => l.message?.startsWith("LIFECYCLE:STOP:"))
            .map(l => l.message);
        expect(stopLogs).toEqual([
            "LIFECYCLE:STOP:D:P30",
            "LIFECYCLE:STOP:C:P20",
            "LIFECYCLE:STOP:B:P10",
            "LIFECYCLE:STOP:A:P0",
        ]);

        // stop() is idempotent - multiple calls don't duplicate teardown
        await t.stop();
        await t.stop();

        const logsAfterMultipleStops = await t.logs.fromStart().retrieve();
        const stopLogsAfter = logsAfterMultipleStops
            .filter(l => l.message?.startsWith("LIFECYCLE:STOP:"))
            .map(l => l.message);
        expect(stopLogsAfter).toEqual(stopLogs); // Same logs, not duplicated
    }, 10000);

    test("failure path - startup failure with cleanup", async () => {
        let capturedError: Error | undefined;

        const t = GGTest.startInline(FailingLifecycleTestRuntime);
        try {
            await t;
        } catch (error) {
            capturedError = error as Error;
        }

        // Error identifies which service failed
        expect(capturedError).toBeDefined();
        expect(capturedError?.message).toContain("LifecycleService-C");
        expect(capturedError?.message).toContain("failed to start");

        // Logs accessible after startup failure
        const logs = await t.logs.fromStart().retrieve();
        const lifecycleLogs = logs
            .filter(l => l.message?.startsWith("LIFECYCLE:"))
            .map(l => l.message);

        // A and B started before C failed
        expect(lifecycleLogs).toContainEqual("LIFECYCLE:START:A:P0");
        expect(lifecycleLogs).toContainEqual("LIFECYCLE:START:B:P10");
        expect(lifecycleLogs).toContainEqual("LIFECYCLE:START:C:P20");

        // D never started (comes after C which failed)
        expect(lifecycleLogs).not.toContainEqual("LIFECYCLE:START:D:P30");

        // Cleanup happened for started services in reverse order
        expect(lifecycleLogs).toContainEqual("LIFECYCLE:STOP:B:P10");
        expect(lifecycleLogs).toContainEqual("LIFECYCLE:STOP:A:P0");

        const stopB = lifecycleLogs.indexOf("LIFECYCLE:STOP:B:P10");
        const stopA = lifecycleLogs.indexOf("LIFECYCLE:STOP:A:P0");
        expect(stopB).toBeLessThan(stopA);
    });
});
