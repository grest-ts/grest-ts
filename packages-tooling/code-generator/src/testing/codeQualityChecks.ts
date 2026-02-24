/**
 * Code quality checks for generated code
 */

export interface CodeQualityResult {
    hasIssues: boolean
    issues: string[]
}

/**
 * Check if generated code has double empty lines
 * Double empty lines indicate a bug in the code generator where too many \n are being added
 */
export function checkDoubleEmptyLines(content: string, filePath?: string): CodeQualityResult {
    const result: CodeQualityResult = {
        hasIssues: false,
        issues: []
    }

    // Check for double empty lines (\n\n\n means 2 consecutive empty lines)
    if (content.includes('\n\n\n')) {
        const lines = content.split('\n')
        const problemLines: number[] = []

        for (let i = 0; i < lines.length - 2; i++) {
            if (lines[i] === '' && lines[i + 1] === '' && lines[i + 2] === '') {
                // Report the line number of the first empty line in the sequence
                if (problemLines.length === 0 || problemLines[problemLines.length - 1] !== i) {
                    problemLines.push(i + 1) // 1-indexed
                }
            }
        }

        if (problemLines.length > 0) {
            result.hasIssues = true
            const fileInfo = filePath ? `in ${filePath}` : ''
            result.issues.push(
                `Found double empty lines ${fileInfo}.\n` +
                `Problem at lines: ${problemLines.join(', ')}\n` +
                `This indicates something is adding too many \\n characters in the code generator.`
            )
        }
    }

    return result
}
