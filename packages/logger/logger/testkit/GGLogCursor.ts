import {LogLevel} from "@grest-ts/logger";
import {GGTestRuntime} from "@grest-ts/testkit";
import {CapturedLogEntry, SerializableLogMatcher} from "./GGTestLogger";
import {GGLogIPC} from "./GGLogCommands";

export type LogMatcher = string | RegExp | Partial<CapturedLogEntry>;

export interface LogQueryOptions {
    minLevel?: LogLevel;
}

/**
 * Represents a cursor position in the log stream.
 * Stores the starting index per runtime for querying logs from that point onwards.
 */
export class GGLogCursor {

    private readonly runtimes: GGTestRuntime[];
    private readonly cursors: Map<GGTestRuntime, number>;

    constructor(runtimes: GGTestRuntime[], cursors: Map<GGTestRuntime, number>) {
        this.runtimes = runtimes;
        this.cursors = cursors;
    }

    /**
     * Find a log entry matching the given matcher across all runtimes.
     * Returns the first match or null if not found.
     */
    async find(matcher: LogMatcher, options?: LogQueryOptions): Promise<CapturedLogEntry | null> {
        const serializable = this.toSerializable(matcher);

        const results = await Promise.all(
            this.runtimes.map(async (runtime) => {
                const fromIndex = this.cursors.get(runtime) ?? 0;
                return runtime.sendCommand(GGLogIPC.worker.findFrom, {
                    fromIndex,
                    matcher: serializable,
                    minLevel: options?.minLevel
                });
            })
        );

        // Return first non-null match (sorted by index for determinism)
        const matches = results.filter((r): r is CapturedLogEntry => r !== null);
        if (matches.length === 0) return null;
        return matches.sort((a, b) => a.index - b.index)[0];
    }

    /**
     * Retrieve all log entries from the cursor position onwards.
     */
    async retrieve(options?: LogQueryOptions): Promise<CapturedLogEntry[]> {
        const allLogs: CapturedLogEntry[] = [];

        await Promise.all(
            this.runtimes.map(async (runtime) => {
                const fromIndex = this.cursors.get(runtime) ?? 0;
                const logs = await runtime.sendCommand(GGLogIPC.worker.retrieveFrom, {
                    fromIndex,
                    minLevel: options?.minLevel
                });
                allLogs.push(...logs);
            })
        );

        // Sort by timestamp for consistent ordering across runtimes
        return allLogs.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Convert LogMatcher to SerializableLogMatcher for IPC.
     */
    private toSerializable(matcher: LogMatcher): SerializableLogMatcher {
        if (typeof matcher === 'string') {
            return { type: 'string', value: matcher };
        }
        if (matcher instanceof RegExp) {
            return { type: 'regex', pattern: matcher.source, flags: matcher.flags };
        }
        return { type: 'object', value: matcher as Record<string, unknown> };
    }
}
