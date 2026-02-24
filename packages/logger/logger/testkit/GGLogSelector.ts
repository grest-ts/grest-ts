import {LogLevel} from "@grest-ts/logger";
import {RuntimeConstructor, GGTestSelector, GGTestSelectorExtension} from "@grest-ts/testkit";
import {GGLogWith} from "./GGLogWith";
import {GGLogCursor, LogMatcher} from "./GGLogCursor";
import {GGLogIPC} from "./GGLogCommands";

/**
 * Logs accessor for selected runtimes.
 * Provides methods to query and search logs during tests.
 *
 * @example
 * // Get a cursor, do action, search for log
 * const checklist = t.get(ChecklistRuntime);
 * const cursor = await checklist.logs.cursor();
 * await alice.doSomething();
 * const match = await cursor.find("expected message");
 * expect(match).toBeDefined();
 *
 * // Or use with() pattern for inline expectations
 * await alice.doSomething()
 *     .with(checklist.logs.expect("expected message"));
 */
export class GGLogSelector extends GGTestSelectorExtension {

    public static readonly PROPERTY_NAME = "logs";

    /**
     * Get a cursor marking the current log position.
     * Use this to query logs that occur after this point.
     */
    async cursor(): Promise<GGLogCursor> {
        const cursors = new Map<typeof this.runtimes[number], number>();

        await Promise.all(
            this.runtimes.map(async (runtime) => {
                const index = await runtime.sendCommand(GGLogIPC.worker.getCursor, undefined);
                cursors.set(runtime, index);
            })
        );

        return new GGLogCursor(this.runtimes, cursors);
    }

    /**
     * Get a cursor positioned at the start (index 0) to retrieve all logs
     * including those from startup. Useful for testing startup order.
     */
    fromStart(): GGLogCursor {
        const cursors = new Map<typeof this.runtimes[number], number>();
        for (const runtime of this.runtimes) {
            cursors.set(runtime, 0);
        }
        return new GGLogCursor(this.runtimes, cursors);
    }

    /**
     * Create a log expectation for use with .with() pattern.
     */
    expect(matcher: LogMatcher, minLevel?: LogLevel): GGLogWith {
        return new GGLogWith(this.runtimes, matcher, minLevel);
    }
}

// Declaration merging to add 'logs' to SelectorExtensions
declare module "@grest-ts/testkit" {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface SelectorExtensions<T extends RuntimeConstructor[]> {
        logs: GGLogSelector;
    }
}

// Ensure RuntimeConstructor import is recognized (for declaration merging above)
export type _RuntimeConstructorRef = RuntimeConstructor;

// Register the extension
GGTestSelector.addExtension(GGLogSelector);
