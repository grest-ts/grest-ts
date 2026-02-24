import {GGLogger, LogEntry, LogLevel} from "@grest-ts/logger";

export interface CapturedLogEntry {
    index: number;
    timestamp: number;
    level: LogLevel;
    contextName?: string;
    message?: string;
    data?: any;
    errorMessage?: string;
    errorStack?: string;
    traceId?: string;
}

/**
 * Serializable log matcher for IPC.
 * RegExp is converted to {type: 'regex', pattern, flags} for transmission.
 */
export type SerializableLogMatcher =
    | { type: 'string', value: string }
    | { type: 'regex', pattern: string, flags: string }
    | { type: 'object', value: Record<string, unknown> };

export class GGTestLogger implements GGLogger {

    private buffer: CapturedLogEntry[] = [];
    private nextIndex: number = 0;
    private readonly maxBufferSize: number = 10000;

    public get minLevel(): LogLevel {
        return LogLevel.DEBUG;
    }

    /**
     * Returns the current log index (cursor position).
     * Use this to mark a starting point for later queries.
     */
    public getCursor(): number {
        return this.nextIndex;
    }

    /**
     * Find a log entry matching the given matcher, starting from fromIndex.
     * Returns the first matching entry or null if not found.
     */
    public findFrom(fromIndex: number, matcher: SerializableLogMatcher, minLevel?: LogLevel): CapturedLogEntry | null {
        for (const entry of this.buffer) {
            if (entry.index < fromIndex) continue;
            if (minLevel !== undefined && entry.level < minLevel) continue;
            if (this.matches(entry, matcher)) {
                return entry;
            }
        }
        return null;
    }

    /**
     * Retrieve all log entries from fromIndex onwards.
     */
    public retrieveFrom(fromIndex: number, minLevel?: LogLevel): CapturedLogEntry[] {
        const result: CapturedLogEntry[] = [];
        for (const entry of this.buffer) {
            if (entry.index < fromIndex) continue;
            if (minLevel !== undefined && entry.level < minLevel) continue;
            result.push(entry);
        }
        return result;
    }

    public log(entry: LogEntry): void {
        const captured: CapturedLogEntry = {
            index: this.nextIndex++,
            timestamp: entry.timestamp.getTime(),
            level: entry.level,
            contextName: entry.contextName,
            message: entry.message,
            data: this.safeSerialize(entry.data),
            traceId: entry.requestContext?.currentTraceId
        };

        if (entry.error) {
            if (entry.error instanceof Error) {
                captured.errorMessage = entry.error.message;
                captured.errorStack = entry.error.stack;
            } else if (typeof entry.error === 'string') {
                captured.errorMessage = entry.error;
            } else {
                captured.errorMessage = String(entry.error);
            }
        }

        this.buffer.push(captured);
        if (this.buffer.length > this.maxBufferSize) {
            this.buffer.shift();
        }
    }

    private matches(entry: CapturedLogEntry, matcher: SerializableLogMatcher): boolean {
        switch (matcher.type) {
            case 'string':
                return entry.message?.includes(matcher.value) ?? false;
            case 'regex': {
                const regex = new RegExp(matcher.pattern, matcher.flags);
                return regex.test(entry.message ?? '');
            }
            case 'object':
                return Object.entries(matcher.value).every(([key, value]) => {
                    const entryValue = entry[key as keyof CapturedLogEntry];
                    if (value instanceof RegExp) {
                        return value.test(String(entryValue));
                    }
                    return entryValue === value;
                });
        }
    }

    private safeSerialize(data: unknown): unknown {
        if (data === undefined || data === null) return data;
        try {
            return JSON.parse(JSON.stringify(data));
        } catch {
            return String(data);
        }
    }
}
