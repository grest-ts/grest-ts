/**
 * @returns path to the source test file
 */
export function captureStackSourceFile(): string {
    return getLinesFromTestFile((new Error().stack ?? "").split("\n"))[0] ?? "[Source not found]";
}

/**
 * Switches source files part of the stack for err with actualSourceLocation, but keeping the original error message.
 */
export function updateErrorStack(err: Error, actualSourceLocation?: Error) {
    const lines = (err.stack ?? '').split("\n");
    const errorLines = getErrorLinesOnly(lines);
    const errLines = (actualSourceLocation?.stack ?? err.stack ?? '').split("\n");
    const fileLines = getLinesFromTestFile(errLines);
    err.stack = errorLines.join("\n") + "\n" + fileLines.join("\n");
    return err;
}

/**
 * Returns error message part of the stack lines. Skips all lines after first path is detected.
 */
function getErrorLinesOnly(lines: string[]): string [] {
    const addedLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("    at ")) {
            break;
        }
        addedLines.push(line);
    }
    return addedLines;
}

/**
 * Returns source file path lines from the lines.
 * Starts stack from the "test" source file and skips all framework paths.
 * For example:
 * '   at PATH_TO_SOURCE'
 */
function getLinesFromTestFile(lines: string[]): string[] {
    const startIdx = lines.findIndex(line => {
        return line.includes('.test.ts')
            || line.includes('.spec.ts')
    });
    const endIds = lines.findIndex(line => {
        return line.includes('@vitest')
    });
    if (startIdx === -1) {
        return [];
    }
    return lines.slice(startIdx, endIds);

}