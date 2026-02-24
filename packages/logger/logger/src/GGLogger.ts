import {LogEntry, LogLevel} from "./types";

/**
 * Logger strategy interface
 */
export interface GGLogger {
    readonly minLevel: LogLevel;
    log(entry: LogEntry): void;
}