import {GGLogger, LogEntry, LogLevel} from "@grest-ts/logger";
import {ERROR} from "@grest-ts/schema";
import {GGFile} from "@grest-ts/schema-file";

export const LOG_LEVELS = [undefined, "DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"]

/**
 * ANSI color codes for beautiful terminal output
 */
export const LOG_COLORS = {
    reset: '\x1b[0m',

    // Text styles
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    underline: '\x1b[4m',

    // Foreground colors (text)
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    orange: '\x1b[38;5;208m',  // 256-color orange

    // Bright foreground colors
    brightBlack: '\x1b[90m',
    brightRed: '\x1b[91m',
    brightGreen: '\x1b[92m',
    brightYellow: '\x1b[93m',
    brightBlue: '\x1b[94m',
    brightMagenta: '\x1b[95m',
    brightCyan: '\x1b[96m',
    brightWhite: '\x1b[97m',

    // Background colors
    bgBlack: '\x1b[40m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan: '\x1b[46m',
    bgWhite: '\x1b[47m',
    bgGray: '\x1b[100m',
    bgOrange: '\x1b[48;5;208m',  // 256-color orange background

    // Bright background colors
    bgBrightBlack: '\x1b[100m',
    bgBrightRed: '\x1b[101m',
    bgBrightGreen: '\x1b[102m',
    bgBrightYellow: '\x1b[103m',
    bgBrightBlue: '\x1b[104m',
    bgBrightMagenta: '\x1b[105m',
    bgBrightCyan: '\x1b[106m',
    bgBrightWhite: '\x1b[107m',
};

function parseLogLevel(value: string | undefined): LogLevel | undefined {
    if (!value) return undefined;
    const index = LOG_LEVELS.indexOf(value.toUpperCase());
    return index > 0 ? index as LogLevel : undefined;
}

/**
 * Console logger with beautiful colored output
 */
export class GGLoggerConsole implements GGLogger {
    public readonly minLevel: LogLevel
    private readonly showData: boolean;
    private readonly timestampFormat: 'full' | 'time';

    // private readonly useConsoleLog: boolean;
    private readonly contextProviders: ((parts: string[]) => void)[] = [];

    constructor(options?: {
        minLevel?: LogLevel;
        showData?: boolean;
        timestampFormat?: 'full' | 'time';
    }) {
        this.minLevel = options?.minLevel ?? parseLogLevel(process.env.LOG_LEVEL) ?? LogLevel.DEBUG;
        this.showData = options?.showData ?? true;
        this.timestampFormat = options?.timestampFormat ?? 'time';
    }

    public addContext(provider: (parts: string[]) => void): this {
        this.contextProviders.push(provider);
        return this;
    }

    public log(entry: LogEntry): void {
        const msg = this.format(entry);
        if (msg === null) {
            return; // Below min level
        }

        console.log(msg);
    }

    /**
     * Format a log entry to a string without printing it.
     * Returns null if the entry is below the minimum log level.
     */
    public format(entry: LogEntry): string | null {
        if (entry.level < this.minLevel) {
            return null;
        }
        const parts: string[] = [];
        parts.push(LOG_COLORS.gray + this.formatTimestamp(entry.timestamp));
        parts.push(LOG_COLORS.white + process.pid);

        const levelColor = this.getLevelColor(entry.level);
        parts.push(levelColor + (LOG_LEVELS[entry.level]?.padEnd(5) ?? "?????"));

        parts.push(LOG_COLORS.cyan + entry.contextName + LOG_COLORS.reset);

        for (let i = 0; i < this.contextProviders.length; i++) {
            this.contextProviders[i](parts);
        }

        if (entry.message !== undefined) {
            parts.push(levelColor + entry.message);
        }

        if (entry.error !== undefined && entry.error !== null) {
            parts.push(this.formatError(levelColor, entry.error));
        }

        if (this.showData && entry.data !== undefined && entry.data !== null) {
            const dataColor = entry.level === LogLevel.INFO ? LOG_COLORS.gray : levelColor;
            parts.push(dataColor + this.formatData(entry.data));
        }


        // let originalError = "";
        // if (entry?.data?.debugData) {
        //     originalError += "\n\tDebug data: " + JSON.stringify(entry.data.debugData, null, 2).split("\n").join("\n\t");
        // }

        return parts.join(' ') + LOG_COLORS.reset;
    }

    private formatTimestamp(date: Date): string {
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        // const ms = String(date.getMilliseconds()).padStart(3, '0');

        const timeString = hours + ':' + minutes + ':' + seconds;

        if (this.timestampFormat === 'full') {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return year + '-' + month + '-' + day + ' ' + timeString;
        }

        return timeString;
    }

    private getLevelColor(level: LogLevel): string {
        switch (level) {
            case LogLevel.CRITICAL:
                return LOG_COLORS.red;
            case LogLevel.ERROR:
                return LOG_COLORS.red;
            case LogLevel.WARN:
                return LOG_COLORS.yellow;
            case LogLevel.INFO:
                return LOG_COLORS.green;
            case LogLevel.DEBUG:
                return LOG_COLORS.gray;
            default:
                return LOG_COLORS.gray;
        }
    }

    private formatData(data: unknown): string {
        if (typeof data === 'string') {
            return data;
        }
        try {
            const sanitized = this.sanitizeForLogging(data);
            const json = JSON.stringify(sanitized);
            // Truncate if too long
            if (json.length > 2000) {
                return json.substring(0, 2000) + '... [truncated]';
            }
            // Indent each line
            return json.split('\n').join('\n    ');
        } catch {
            return String(data);
        }
    }

    /**
     * Sanitize data for logging - replace large buffers and files with summaries
     */
    private sanitizeForLogging(data: unknown, depth: number = 0): unknown {
        if (depth > 10) return '[max depth]';
        if (data === null || data === undefined) return data;

        // Handle Uint8Array/Buffer - show summary instead of all bytes
        if (data instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(data))) {
            return `[Buffer: ${data.length} bytes]`;
        }

        // Handle ArrayBuffer
        if (data instanceof ArrayBuffer) {
            return `[ArrayBuffer: ${data.byteLength} bytes]`;
        }

        // Handle GGFile-like objects (duck typing)
        if (data instanceof GGFile) {
            const file = data as { name: string, mimeType: string, size: number };
            return `[GGFile: ${file.name} (${file.mimeType}, ${file.size} bytes)]`;
        }

        // Handle arrays
        if (Array.isArray(data)) {
            if (data.length > 100) {
                return `[Array: ${data.length} items]`;
            }
            return data.map(item => this.sanitizeForLogging(item, depth + 1));
        }

        // Handle objects
        if (typeof data === 'object') {
            const keys = Object.keys(data);
            if (keys.length > 50) {
                return `[Object: ${keys.length} keys]`;
            }
            const result: Record<string, unknown> = {};
            for (const key of keys) {
                result[key] = this.sanitizeForLogging((data as any)[key], depth + 1);
            }
            return result;
        }

        return data;
    }

    private formatError(levelColor: string, error: unknown): string {

        if (typeof error === 'string') {
            return error;
        }

        if (error instanceof ERROR) {
            const debugData = error.getDebugContext()
            const baseMsg = levelColor + error.toText("\n\t" + LOG_COLORS.gray);

            let originalError = "";
            if (debugData?.originalError) {
                originalError += "\n\tOriginal error: " + this.tabData(1, this.formatError(levelColor, debugData.originalError));
            }

            let debugDataStr = "";
            if (debugData?.debugData) {
                debugDataStr += "\n\tDebug data: " + this.tabData(1, JSON.stringify(debugData.debugData, null, 2));
            }

            let stack = "";
            if (error.stack) {
                const stackLines = error.stack.split('\n');
                stackLines.shift();
                stack = stackLines.join("\n");
                stack = "\n" + stack
            }

            return baseMsg + stack + debugDataStr + originalError;

        } else if (error instanceof Error) {
            return levelColor + error.stack;

        } else {
            return levelColor + String(error);
        }
    }

    private tabData(tabs: number, data: string) {
        const tabsStr = "\t".repeat(tabs);
        return data.split('\n').join('\n' + tabsStr);
    }

}
