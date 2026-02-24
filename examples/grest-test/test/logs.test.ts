import {callOn, GGTest} from "@grest-ts/testkit";
import {LogLevel} from "@grest-ts/logger";
import {MainRuntime} from "../src/main";
import {ConfigTestApi} from "../src/api/ConfigTestApi";

/**
 * Tests for log capture functionality in the test framework.
 *
 * The ConfigTestService logs at DEBUG level when logMessage is called:
 *   GGLog.debug(this, 'Log message: ' + request.message);
 */
describe.concurrent("logs", () => {

    const t = GGTest.startInline([MainRuntime, MainRuntime]);
    const client = callOn(ConfigTestApi);

    test("cursor().retrieve() gets logs produced after cursor", async () => {
        const cursor = await t.logs.cursor();

        await client.logMessage({message: "test capture"});

        const logs = await cursor.retrieve();

        const logEntry = logs.find(l => l.message?.includes("Log message: test capture"));
        expect(logEntry).toBeDefined();
        expect(logEntry?.level).toBe(LogLevel.DEBUG);
        expect(logEntry?.contextName).toBe("ConfigTestService");
    });

    test("cursor().find() searches for matching log", async () => {
        const cursor = await t.logs.cursor();

        await client.logMessage({message: "find test"});

        const match = await cursor.find("Log message: find test");
        expect(match).toBeDefined();
        expect(match?.contextName).toBe("ConfigTestService");
    });

    test("cursor().find() with regex matcher", async () => {
        const cursor = await t.logs.cursor();

        await client.logMessage({message: "regex456"});

        const match = await cursor.find(/regex\d+/);
        expect(match).toBeDefined();
    });

    test("retrieve with minLevel filters logs", async () => {
        const cursor = await t.logs.cursor();

        await client.logMessage({message: "level test"});

        // Only get INFO and above (excluding DEBUG)
        const logs = await cursor.retrieve({minLevel: LogLevel.INFO});

        // ConfigTestService logs at DEBUG, should be filtered out
        const debugLogs = logs.filter(l => l.level === LogLevel.DEBUG);
        expect(debugLogs).toHaveLength(0);
    });

    test("retrieved logs have correct CapturedLogEntry structure", async () => {
        const cursor = await t.logs.cursor();

        await client.logMessage({message: "structure test"});

        const logs = await cursor.retrieve();

        expect(logs.length).toBeGreaterThan(0);

        const log = logs[0];
        expect(typeof log.index).toBe("number");
        expect(typeof log.timestamp).toBe("number");
        expect(log.timestamp).toBeGreaterThan(0);
        expect(typeof log.level).toBe("number");
        expect(log.contextName).toBeDefined();
    });

    test("logs from multiple runtimes are sorted by timestamp", async () => {
        const cursor = await t.logs.cursor();

        await client.logMessage({message: "multi-runtime"});

        const logs = await cursor.retrieve();

        // Verify timestamps are in ascending order
        for (let i = 1; i < logs.length; i++) {
            expect(logs[i].timestamp).toBeGreaterThanOrEqual(logs[i - 1].timestamp);
        }
    });

    test("log expectation with .with() pattern", async () => {
        await client.logMessage({message: "expectation test"})
            .with(t.logs.expect("Log message: expectation test"));
    });

    test("log expectation with regex matcher", async () => {
        await client.logMessage({message: "regex123"})
            .with(t.logs.expect(/regex\d+/));
    });

    test("log expectation with object matcher", async () => {
        await client.logMessage({message: "object test"})
            .with(t.logs.expect({
                contextName: "ConfigTestService",
                level: LogLevel.DEBUG
            }));
    });

    test("waitFor waits for delayed log after method returns", async () => {
        const delay = 100;

        // Safety check that this test first fails with this delay.
        await expect(client.logDelayed({message: "delayed test", delayMs: delay})
            .with(t.logs.expect("Delayed log: delayed test"))
        ).rejects.toThrow()

        // Call the method that returns immediately but logs the message later
        await client.logDelayed({message: "delayed test", delayMs: delay})
            .waitFor(t.logs.expect("Delayed log: delayed test"));
    });

    test("multiple runtime instances have independent logs", async () => {
        // Verify we have 2 configTest instances
        expect(t.length).toBe(2);

        // Get cursors from each instance SEPARATELY
        const cursor0 = await t[0].logs.cursor();
        const cursor1 = await t[1].logs.cursor();

        // Do an action - request goes to only ONE runtime instance
        await client.logMessage({message: "multi-instance test"});

        // Retrieve from each instance
        const logs0 = await cursor0.retrieve();
        const logs1 = await cursor1.retrieve();

        // The request-handling logs should only be in ONE instance
        const hasLog0 = logs0.find(l => l.message?.includes("Log message: multi-instance test"));
        const hasLog1 = logs1.find(l => l.message?.includes("Log message: multi-instance test"));

        // Exactly one should have the log, not both
        const found0 = hasLog0 !== undefined;
        const found1 = hasLog1 !== undefined;
        expect(found0 !== found1).toBe(true); // XOR - exactly one has it
    });

    test("fromStart() on describe-block runtime includes its startup logs", async () => {
        // This runtime was started at describe-block level - verify we can get its startup logs
        const startupLogs = await t.logs.fromStart().retrieve();
        const messages = startupLogs.map(l => l.message);

        // Should have startup logs from when describe-block runtime started
        // expect(messages).toContainEqual("Runtime starting");
        expect(messages).toContainEqual("Runtime running");
    });
});

describe("logs - startup and shutdown accessibility", () => {

    test("fromStart() captures startup logs, logs accessible after stop with shutdown logs", async () => {
        const t = await GGTest.startInline(MainRuntime);
        const client = callOn(ConfigTestApi);

        // fromStart() should include startup logs
        const startupLogs = await t.logs.fromStart().retrieve();
        const startupMessages = startupLogs.map(l => l.message);
        // expect(startupMessages).toContainEqual("Runtime starting");
        // expect(startupMessages).toContainEqual("Composing services...");
        expect(startupMessages).toContainEqual("Starting...");
        expect(startupMessages).toContainEqual("Runtime running");

        // Log something while runtime is running
        await client.logMessage({message: "before stop test"});

        // Stop the runtime
        await t.stop();

        // Logs should still be accessible via IPC after stop
        const allLogs = await t.logs.fromStart().retrieve();
        const found = allLogs.find(l => l.message?.includes("Log message: before stop test"));
        expect(found).toBeDefined();

        // Shutdown logs should also be captured
        const shutdownLog = allLogs.find(l => l.message?.includes("Shutdown complete"));
        expect(shutdownLog).toBeDefined();
    });
});
