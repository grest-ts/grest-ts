import {LOG_COLORS} from "@grest-ts/logger-console";

export class GGTestError extends Error {

    constructor(data: CreateErrorInput) {

        const tab = (n: number, str: string) => {
            return str.split("\n").join("\n" + ("\t".repeat(n)));
        }

        const fixValue = (value: any): string => {
            if (value instanceof Error) {
                return value.stack ?? value.message
            } else if (typeof value === "object") {
                return JSON.stringify(value, null, 2)
            } else {
                return String(value);
            }
        }

        super("Error: " + (data.context ? data.context + " " : "") + data.test + "\n" +
            "\nExpected: " + LOG_COLORS.green + tab(1, fixValue(data.expected)) + LOG_COLORS.reset +
            "\nReceived: " + tab(1, fixValue(data.received)) +
            (data.extra ? "\n\t" + tab(1, data.extra) : "") +
            (data.sourceFile ? "\n\t" + tab(1, data.sourceFile) : "") +
            "\n");
    }
}

interface CreateErrorInput {
    context?: string;
    test: string,
    expected: any,
    received: any,
    extra?: any
    sourceFile?: string;
}