import {GGLogger} from "./GGLogger";
import {LogEntry, LogLevel} from "./types";

/**
 * Holds the active GGLog instance for the current execution context. On the
 * server GGLogStore.node backs this with the locator scope (per-runtime
 * isolation); the browser default below is a plain module singleton — one
 * logger config per page, no async-context machinery — so @grest-ts/locator
 * (a node-only DI / async-context package) never reaches the browser bundle.
 */
export interface GGLogStore {
    get(): GGLog
    tryGet(): GGLog | undefined
    /** `scope` is a GGLocatorScope on the server; the browser store ignores it. */
    set(instance: GGLog, scope?: unknown): void
}

let browserInstance: GGLog | undefined
let store: GGLogStore = {
    get(): GGLog {
        if (!browserInstance) throw new Error("GGLog not initialized — call GGLog.init() first");
        return browserInstance;
    },
    tryGet: () => browserInstance,
    set: (instance) => { browserInstance = instance; },
};

/** Install a different backing store. GGLogStore.node calls this to switch to
 *  locator-scoped resolution; not for app code. */
export function _setGGLogStore(s: GGLogStore): void {
    store = s;
}

/** The active GGLog instance. Shape kept from the former locator key so every
 *  `store.get()` / `store.tryGet()` callsite is unchanged. */
export const GG_LOG = {
    get: (): GGLog => store.get(),
    tryGet: (): GGLog | undefined => store.tryGet(),
};

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
    // LogLevel | (number & {}) keeps the named levels visible while still allowing the CRITICAL + 1 "nothing logged" sentinel and Math.min(...) of logger levels.
    private globalMinLevel: LogLevel | (number & {}) = LogLevel.CRITICAL + 1;

    private constructor() {
    }

    /**
     * Initialize GGLog - creates a new instance and adds it to the current context.
     */
    public static init(scope?: unknown): GGLog {
        const instance = new GGLog();
        store.set(instance, scope);
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
        return store.get().loggers.find((l): l is T => l instanceof type);
    }

    public getLoggerInstance<T extends GGLogger>(type: new (...args: any[]) => T): T | undefined {
        return this.loggers.find((l): l is T => l instanceof type);
    }

    public static add(logger: GGLogger): void {
        store.get().addLogger(logger);
    }

    public static clear(): void {
        store.tryGet()?.clearLoggers();
    }

    public static isLevelLogged(level: LogLevel): boolean {
        return store.get().isLevelLoggedInternal(level);
    }

    private static log(
        level: LogLevel,
        context: any,
        messageOrError: string | any | Error,
        dataOrError: any | Error,
        possiblyError: Error
    ): void {
        const ctx = store.tryGet();
        if (!ctx) {
            console.warn("Log context not setup for message: ", messageOrError, dataOrError, possiblyError);
            return;
        }

        // Fast path: skip all work if no logger cares about this level
        if (!ctx.isLevelLoggedInternal(level)) {
            return;
        }

        let message: string | undefined = undefined;
        let data: any = undefined;
        let error: Error | undefined = undefined

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
