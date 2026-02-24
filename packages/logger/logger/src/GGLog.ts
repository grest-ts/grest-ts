import {GGLocator, GGLocatorKey, GGLocatorScope} from "@grest-ts/locator";
import {GGLogger} from "./GGLogger";
import {LogEntry, LogLevel} from "./types";

export const GG_LOG = new GGLocatorKey<GGLog>("GGLog");

/**
 * Logging system with async context awareness.
 *
 * GGLog uses GGAsyncContext for context propagation. It adds itself to
 * whatever context exists, enabling per-runtime logger isolation.
 *
 * Usage:
 * - Initialize: `GGLog.init()` (adds GGLog to current context)
 * - Add loggers: `GGLog.add(new GGLoggerConsole())`
 * - Log messages: `GGLog.info(this, "message", {data})`
 */
export class GGLog {

    private readonly loggers: GGLogger[] = [];
    private globalMinLevel: LogLevel = LogLevel.CRITICAL + 1; // No loggers = nothing logged

    private constructor() {
    }

    /**
     * Initialize GGLog - creates a new instance and adds it to the current context.
     */
    public static init(scope?: GGLocatorScope): GGLog {
        const instance = new GGLog();
        (scope ?? GGLocator.getScope()).set(GG_LOG, instance);
        return instance;
    }

    // -----------------------------------------------
    // Instance methods (operate on current context's loggers)
    // -----------------------------------------------

    public addLogger(logger: GGLogger): this {
        this.loggers.push(logger);
        if (this.loggers.length === 0) {
            this.globalMinLevel = LogLevel.CRITICAL + 1;
        } else {
            this.globalMinLevel = Math.min(...this.loggers.map(l => l.minLevel));
        }
        return this;
    }

    private clearLoggers(): void {
        this.loggers.length = 0;
        this.globalMinLevel = LogLevel.CRITICAL + 1;
    }

    private isLevelLoggedInternal(level: LogLevel): boolean {
        return level >= this.globalMinLevel;
    }

    private log(entry: LogEntry): void {
        for (const logger of this.loggers) {
            try {
                logger.log(entry);
            } catch (error) {
                // Prevent logger errors from breaking the application
                console.error('Logger error:', error);
            }
        }
    }

    // -----------------------------------------------
    // Static methods - main API
    // -----------------------------------------------

    public static getLogger<T extends GGLogger>(type: new (...args: any[]) => T): T | undefined {
        return GG_LOG.get().loggers.find((l): l is T => l instanceof type);
    }

    public getLoggerInstance<T extends GGLogger>(type: new (...args: any[]) => T): T | undefined {
        return this.loggers.find((l): l is T => l instanceof type);
    }

    public static add(logger: GGLogger): void {
        GG_LOG.get().addLogger(logger);
    }

    public static clear(): void {
        GG_LOG.tryGet()?.clearLoggers();
    }

    public static isLevelLogged(level: LogLevel): boolean {
        return GG_LOG.get().isLevelLoggedInternal(level);
    }

    private static log(
        level: LogLevel,
        context: any,
        messageOrError: string | any | Error,
        dataOrError: any | Error,
        possiblyError: Error
    ): void {
        const ctx = GG_LOG.tryGet();
        if (!ctx) {
            console.warn("Log context not setup for message: ", messageOrError, dataOrError, possiblyError);
            return;
        }

        // Fast path: skip all work if no logger cares about this level
        if (!ctx.isLevelLoggedInternal(level)) {
            return;
        }

        let message: string = undefined;
        let data: any = undefined;
        let error: Error = undefined

        if (typeof messageOrError === "string") {
            message = messageOrError;
        } else if (messageOrError instanceof Error) {
            error = messageOrError;
        } else if (messageOrError) {
            data = messageOrError;
        }

        if (dataOrError instanceof Error) {
            error = dataOrError;
        } else if (dataOrError) {
            data = dataOrError;
        }

        if (possiblyError instanceof Error) {
            error = possiblyError;
        }

        // This is to support GGHttpError log levels
        if (error && "logLevel" in error) {
            if (error.logLevel === "error") {
                level = LogLevel.ERROR
            } else if (error.logLevel === "warn") {
                level = LogLevel.WARN
            } else if (error.logLevel === "info") {
                level = LogLevel.INFO
            } else if (error.logLevel === "debug") {
                level = LogLevel.DEBUG
            }
        }

        const entry: LogEntry = {
            timestamp: new Date(),
            level,
            contextName: typeof context === 'string' ? context : (context?.name ?? context?.constructor?.name),
            message,
            data,
            error,
            requestContext: undefined
        };

        ctx.log(entry);
    }

    // -----------------------------------------------
    // Convenience methods
    // -----------------------------------------------

    public static debug(context: any, error: Error, data?: any): void
    public static debug(context: any, message: string, data?: any): void
    public static debug(context: any, message: string, error: Error, data?: any): void
    public static debug(context: any, a: any, b?: any, c?: any): void {
        this.log(LogLevel.DEBUG, context, a, b, c);
    }

    public static info(context: any, error: Error, data?: any): void
    public static info(context: any, message: string, data?: any): void
    public static info(context: any, message: string, error: Error, data?: any): void
    public static info(context: any, a: any, b?: any, c?: any): void {
        this.log(LogLevel.INFO, context, a, b, c);
    }

    public static warn(context: any, error: Error, data?: any): void
    public static warn(context: any, message: string, data?: any): void
    public static warn(context: any, message: string, error: Error, data?: any): void
    public static warn(context: any, a: any, b?: any, c?: any): void {
        this.log(LogLevel.WARN, context, a, b, c);
    }

    public static error(context: any, error: Error, data?: any): void
    public static error(context: any, message: string, data?: any): void
    public static error(context: any, message: string, error: Error, data?: any): void
    public static error(context: any, a: any, b?: any, c?: any): void {
        this.log(LogLevel.ERROR, context, a, b, c);
    }

    public static critical(context: any, error: Error, data?: any): void
    public static critical(context: any, message: string, data?: any): void
    public static critical(context: any, message: string, error: Error, data?: any): void
    public static critical(context: any, a: any, b?: any, c?: any): void {
        this.log(LogLevel.CRITICAL, context, a, b, c);
    }
}
