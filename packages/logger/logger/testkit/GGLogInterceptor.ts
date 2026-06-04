import {LogLevel} from "@grest-ts/logger";
import {GGTestError, GGTestRuntime, IGGTestInterceptor} from "@grest-ts/testkit";
import {CapturedLogEntry, SerializableLogMatcher} from "./GGTestLogger";
import {LogMatcher} from "./GGLogCursor";
import {GGLogIPC} from "./GGLogCommands";

const LOG_LEVEL_NAME: Record<number, string> = Object.fromEntries(
    Object.entries(LogLevel).map(([name, value]) => [value, name])
);

export class GGLogInterceptor implements IGGTestInterceptor {

    private readonly runtimes: GGTestRuntime[];
    private readonly matcher: LogMatcher;
    private readonly minLevel?: LogLevel;
    private readonly definedInSourceFile: string;

    private cursors: Map<GGTestRuntime, number> = new Map();
    private found: boolean = false;
    private polling: boolean = false;
    private validationError?: Error;

    constructor(runtimes: GGTestRuntime[], matcher: LogMatcher, minLevel: LogLevel | undefined, definedInSourceFile: string) {
        this.runtimes = runtimes;
        this.matcher = matcher;
        this.minLevel = minLevel;
        this.definedInSourceFile = definedInSourceFile;
    }

    register(): void {
        // Get cursor positions from each runtime
        for (const runtime of this.runtimes) {
            runtime.sendCommand(GGLogIPC.worker.getCursor, undefined).then(index => {
                this.cursors.set(runtime, index);
            });
        }
    }

    unregister(): void {
    }

    async validate(): Promise<void> {
        // Do a final poll to catch any logs we might have missed
        await this.pollForMatch();

        if (!this.found) {
            // Get all logs for error message
            const allLogs = await this.retrieveAllLogs();
            this.validationError = new GGTestError({
                test: "Expected log entry not found",
                expected: this.describeExpectation(),
                received: allLogs.length === 0
                    ? "No logs captured"
                    : allLogs.map(l => `[${LOG_LEVEL_NAME[l.level]}] ${l.contextName}: ${l.message}`).join("\n"),
                sourceFile: this.definedInSourceFile
            });
        }
    }

    getMockValidationError(): Error | undefined {
        return this.validationError;
    }

    isCalled(): boolean {
        if (this.found) {
            return true;
        }
        // Trigger async poll if not already polling
        if (!this.polling) {
            this.polling = true;
            this.pollForMatch().finally(() => {
                this.polling = false;
            });
        }
        return this.found;
    }

    private async pollForMatch(): Promise<void> {
        if (this.found) return;

        const serializable = this.toSerializable(this.matcher);

        const results = await Promise.all(
            this.runtimes.map(async (runtime) => {
                const fromIndex = this.cursors.get(runtime) ?? 0;
                return runtime.sendCommand(GGLogIPC.worker.findFrom, {
                    fromIndex,
                    matcher: serializable,
                    minLevel: this.minLevel
                });
            })
        );

        const match = results.find((r): r is CapturedLogEntry => r !== null);
        if (match) {
            this.found = true;
        }
    }

    private async retrieveAllLogs(): Promise<CapturedLogEntry[]> {
        const allLogs: CapturedLogEntry[] = [];

        await Promise.all(
            this.runtimes.map(async (runtime) => {
                const fromIndex = this.cursors.get(runtime) ?? 0;
                const logs = await runtime.sendCommand(GGLogIPC.worker.retrieveFrom, {
                    fromIndex,
                    minLevel: this.minLevel
                });
                allLogs.push(...logs);
            })
        );

        return allLogs.sort((a, b) => a.timestamp - b.timestamp);
    }

    private toSerializable(matcher: LogMatcher): SerializableLogMatcher {
        if (typeof matcher === 'string') {
            return {type: 'string', value: matcher};
        }
        if (matcher instanceof RegExp) {
            return {type: 'regex', pattern: matcher.source, flags: matcher.flags};
        }
        return {type: 'object', value: matcher as Record<string, unknown>};
    }

    private describeExpectation(): string {
        if (typeof this.matcher === 'string') {
            return `Log containing: "${this.matcher}"`;
        }
        if (this.matcher instanceof RegExp) {
            return `Log matching: ${this.matcher}`;
        }
        return `Log matching: ${JSON.stringify(this.matcher)}`;
    }
}
