import * as ts from 'typescript'
import * as fs from 'fs'

/**
 * CodeGeneratorError - Enhanced error class for code generation failures
 *
 * Provides detailed context including:
 * - File path and line numbers
 * - Source code snippet showing the problematic code
 * - Clear error messages with actionable suggestions
 *
 * This makes it easy for developers to find and fix issues in their API definitions.
 */
export class CodeGeneratorError extends Error {
    constructor(
        message: string,
        options?: {
            filePath?: string
            node?: ts.Node
            sourceFile?: ts.SourceFile
            line?: number
            column?: number
            snippet?: string
        }
    ) {
        let fullMessage = message

        // Build enhanced error message with context
        if (options?.filePath) {
            let location = options.filePath
            let line: number | undefined
            let column: number | undefined

            // Extract line and column from node if available
            if (options.node && options.sourceFile) {
                const pos = options.sourceFile.getLineAndCharacterOfPosition(options.node.getStart())
                line = pos.line + 1
                column = pos.character + 1
            } else if (options.line !== undefined) {
                line = options.line
                column = options.column
            }

            // Build location string
            if (line !== undefined) {
                location = `${location}:${line}`
                if (column !== undefined) {
                    location += `:${column}`
                }
            }

            fullMessage += `\n\n  at ${location}`

            // Add source code snippet if we have node and sourceFile
            if (options.node && options.sourceFile) {
                const snippet = CodeGeneratorError.extractCodeSnippet(options.node, options.sourceFile)
                if (snippet) {
                    fullMessage += `\n\n${snippet}`
                }
            } else if (options.snippet) {
                fullMessage += `\n\n${options.snippet}`
            } else if (options.filePath && line !== undefined) {
                // Try to load the file and show snippet
                const snippet = CodeGeneratorError.extractCodeSnippetFromFile(options.filePath, line, column)
                if (snippet) {
                    fullMessage += `\n\n${snippet}`
                }
            }
        }

        super(fullMessage)
        this.name = 'CodeGeneratorError'
    }

    /**
     * Extract a code snippet from a TypeScript node
     */
    private static extractCodeSnippet(node: ts.Node, sourceFile: ts.SourceFile): string | null {
        try {
            const start = node.getStart(sourceFile)
            const {line: startLine, character: startCol} = sourceFile.getLineAndCharacterOfPosition(start)

            // Get the full source text
            const fullText = sourceFile.getFullText()
            const lines = fullText.split('\n')

            // Show 2 lines before and after the error (or as many as available)
            const contextLines = 2
            const firstLine = Math.max(0, startLine - contextLines)
            const lastLine = Math.min(lines.length - 1, startLine + contextLines)

            // Build the snippet
            let snippet = '  Source code:\n'
            for (let i = firstLine; i <= lastLine; i++) {
                const lineNum = (i + 1).toString().padStart(4, ' ')
                const prefix = i === startLine ? '  > ' : '    '
                snippet += `${prefix}${lineNum} | ${lines[i]}\n`

                // Add a marker pointing to the column
                if (i === startLine) {
                    const markerIndent = prefix.length + lineNum.length + 3 + startCol
                    snippet += ' '.repeat(markerIndent) + '^\n'
                }
            }

            return snippet
        } catch (e) {
            return null
        }
    }

    /**
     * Extract a code snippet from a file given line and column
     */
    private static extractCodeSnippetFromFile(
        filePath: string,
        line: number,
        column?: number
    ): string | null {
        try {
            if (!fs.existsSync(filePath)) {
                return null
            }

            const content = fs.readFileSync(filePath, 'utf-8')
            const lines = content.split('\n')

            // Show 2 lines before and after the error (or as many as available)
            const contextLines = 2
            const errorLine = line - 1 // Convert to 0-based
            const firstLine = Math.max(0, errorLine - contextLines)
            const lastLine = Math.min(lines.length - 1, errorLine + contextLines)

            // Build the snippet
            let snippet = '  Source code:\n'
            for (let i = firstLine; i <= lastLine; i++) {
                const lineNum = (i + 1).toString().padStart(4, ' ')
                const prefix = i === errorLine ? '  > ' : '    '
                snippet += `${prefix}${lineNum} | ${lines[i]}\n`

                // Add a marker pointing to the column
                if (i === errorLine && column !== undefined) {
                    const markerIndent = prefix.length + lineNum.length + 3 + column - 1
                    snippet += ' '.repeat(markerIndent) + '^\n'
                }
            }

            return snippet
        } catch (e) {
            return null
        }
    }

    /**
     * Create an error for type resolution failures
     */
    static typeResolutionError(typeName: string, filePath?: string): CodeGeneratorError {
        return new CodeGeneratorError(
            `Unable to resolve type: ${typeName}\n\n` +
            `  Make sure the type is:\n` +
            `  - Exported from the file\n` +
            `  - Properly imported if from another module\n` +
            `  - Not a generic type parameter without bounds`,
            {filePath}
        )
    }

    /**
     * Create an error for validator generation failures
     */
    static validatorGenerationError(
        reason: string,
        typeName: string,
        context?: any,
        filePath?: string
    ): CodeGeneratorError {
        const contextStr = context ? `\n\n  Context: ${JSON.stringify(context, null, 2)}` : ''
        return new CodeGeneratorError(
            `Validator generation failed for type: ${typeName}\n` +
            `  Reason: ${reason}${contextStr}`,
            {filePath}
        )
    }

    /**
     * Create an error for missing files
     */
    static fileNotFoundError(filePath: string, additionalInfo?: string): CodeGeneratorError {
        const info = additionalInfo ? `\n  ${additionalInfo}` : ''
        return new CodeGeneratorError(
            `File not found: ${filePath}${info}`,
            {filePath}
        )
    }

    /**
     * Create an error for TypeScript configuration issues
     */
    static configError(message: string, configPath?: string): CodeGeneratorError {
        return new CodeGeneratorError(
            `Configuration error: ${message}`,
            {filePath: configPath}
        )
    }

    /**
     * Create an error for parameter type issues
     */
    static parameterTypeError(
        paramName: string,
        filePath: string,
        node?: ts.Node,
        sourceFile?: ts.SourceFile
    ): CodeGeneratorError {
        return new CodeGeneratorError(
            `Parameter '${paramName}' must have a type annotation\n\n` +
            `  All API parameters must have explicit types for code generation to work.`,
            {filePath, node, sourceFile}
        )
    }

    /**
     * Create an error for project initialization failures
     */
    static projectNotInitializedError(component: string): CodeGeneratorError {
        return new CodeGeneratorError(
            `Project not initialized in ${component}\n\n` +
            `  This is likely an internal error. Please report this issue.`
        )
    }

    /**
     * Create an error for generation failures with details
     */
    static generationError(
        component: string,
        details: string,
        filePath?: string
    ): CodeGeneratorError {
        return new CodeGeneratorError(
            `${component} generation failed\n  ${details}`,
            {filePath}
        )
    }
}
