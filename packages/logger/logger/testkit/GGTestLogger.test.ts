import {beforeAll, describe, expect, test} from "vitest";
import {GGLog, LogLevel} from "@grest-ts/logger";
import {GGTestLogger} from "./GGTestLogger";
import {GGLocatorScope} from "@grest-ts/locator";

describe("GGTestLogger", () => {

    let store: GGTestLogger;

    beforeAll(() => {
        // Set up our own locator scope for testing (not using GGTestRunner)
        new GGLocatorScope("LoggerTest").enter();
        GGLog.init();
        store = new GGTestLogger();
        GGLog.add(store);
    });

    test("captures all logs in buffer", () => {
        const cursor = store.getCursor();

        GGLog.info("TestContext", "Test message", {data: "value"});
        GGLog.debug("TestContext", "Debug message");
        GGLog.warn("TestContext", "Warning message");

        const logs = store.retrieveFrom(cursor);

        expect(logs).toHaveLength(3);
        expect(logs[0].message).toBe("Test message");
        expect(logs[0].level).toBe(LogLevel.INFO);
        expect(logs[0].contextName).toBe("TestContext");
        expect(logs[0].data).toEqual({data: "value"});

        expect(logs[1].message).toBe("Debug message");
        expect(logs[1].level).toBe(LogLevel.DEBUG);

        expect(logs[2].message).toBe("Warning message");
        expect(logs[2].level).toBe(LogLevel.WARN);
    });

    test("retrieveFrom with minLevel filters logs", () => {
        const cursor = store.getCursor();

        GGLog.debug("TestContext", "Debug - should be skipped");
        GGLog.info("TestContext", "Info - should be skipped");
        GGLog.warn("TestContext", "Warning - should be captured");
        GGLog.error("TestContext", "Error - should be captured");

        const logs = store.retrieveFrom(cursor, LogLevel.WARN);

        expect(logs).toHaveLength(2);
        expect(logs[0].level).toBe(LogLevel.WARN);
        expect(logs[1].level).toBe(LogLevel.ERROR);
    });

    test("cursor advances with new logs", () => {
        const cursor1 = store.getCursor();
        GGLog.info("TestContext", "First message");

        const cursor2 = store.getCursor();
        expect(cursor2).toBeGreaterThan(cursor1);

        GGLog.info("TestContext", "Second message");

        const logs1 = store.retrieveFrom(cursor1);
        const logs2 = store.retrieveFrom(cursor2);

        expect(logs1).toHaveLength(2);
        expect(logs2).toHaveLength(1);
        expect(logs2[0].message).toBe("Second message");
    });

    test("findFrom finds matching log", () => {
        const cursor = store.getCursor();

        GGLog.info("TestContext", "First message");
        GGLog.info("TestContext", "Target message");
        GGLog.info("TestContext", "Third message");

        const found = store.findFrom(cursor, {type: 'string', value: 'Target'});

        expect(found).toBeDefined();
        expect(found?.message).toBe("Target message");
    });

    test("findFrom with regex matcher", () => {
        const cursor = store.getCursor();

        GGLog.info("TestContext", "Message abc123");

        const found = store.findFrom(cursor, {type: 'regex', pattern: 'abc\\d+', flags: ''});

        expect(found).toBeDefined();
        expect(found?.message).toBe("Message abc123");
    });

    test("findFrom with object matcher", () => {
        const cursor = store.getCursor();

        GGLog.info("OtherContext", "Some message");
        GGLog.warn("TestContext", "Warning message");

        const found = store.findFrom(cursor, {
            type: 'object',
            value: {contextName: 'TestContext', level: LogLevel.WARN}
        });

        expect(found).toBeDefined();
        expect(found?.message).toBe("Warning message");
    });

    test("findFrom returns null when no match", () => {
        const cursor = store.getCursor();

        GGLog.info("TestContext", "Some message");

        const found = store.findFrom(cursor, {type: 'string', value: 'NotFound'});

        expect(found).toBeNull();
    });

    test("captures error information", () => {
        const cursor = store.getCursor();

        const error = new Error("Test error");
        GGLog.error("TestContext", "Error occurred", error);

        const logs = store.retrieveFrom(cursor);

        expect(logs).toHaveLength(1);
        expect(logs[0].errorMessage).toBe("Test error");
        expect(logs[0].errorStack).toBeDefined();
    });

    test("serializes data to JSON-safe format", () => {
        const cursor = store.getCursor();

        const circularObj: any = {name: "test"};
        circularObj.self = circularObj;

        // This would fail JSON.stringify, so it should be converted to string
        GGLog.info("TestContext", "Circular data", circularObj);

        const logs = store.retrieveFrom(cursor);

        expect(logs).toHaveLength(1);
        // The circular object should be converted to a string representation
        expect(typeof logs[0].data).toBe("string");
    });

    test("timestamps are in epoch milliseconds", () => {
        const before = Date.now();
        const cursor = store.getCursor();
        GGLog.info("TestContext", "Test message");
        const after = Date.now();

        const logs = store.retrieveFrom(cursor);

        expect(logs[0].timestamp).toBeGreaterThanOrEqual(before);
        expect(logs[0].timestamp).toBeLessThanOrEqual(after);
    });

    test("each log entry has unique incrementing index", () => {
        const cursor = store.getCursor();

        GGLog.info("TestContext", "Message 1");
        GGLog.info("TestContext", "Message 2");
        GGLog.info("TestContext", "Message 3");

        const logs = store.retrieveFrom(cursor);

        expect(logs[0].index).toBeLessThan(logs[1].index);
        expect(logs[1].index).toBeLessThan(logs[2].index);
    });
});
