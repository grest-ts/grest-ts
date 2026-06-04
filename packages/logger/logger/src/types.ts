import {enumOf, type Values} from "@grest-ts/common";

/**
 * Complete log entry structure
 */
export interface LogEntry {
    timestamp: Date;
    level: LogLevel;
    contextName?: string; // Name of the class/source where log was written
    message?: string;
    data?: any;
    error?: Error | string | unknown;
    requestContext?: any; // TODO: Refactor to use new context system
}

/**
 * Log levels
 */
export const LogLevel = enumOf({
    DEBUG: 1,
    INFO: 2,
    WARN: 3,
    ERROR: 4,
    CRITICAL: 5,
});
export type LogLevel = Values<typeof LogLevel>;