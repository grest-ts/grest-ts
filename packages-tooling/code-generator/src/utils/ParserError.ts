import * as ts from 'typescript'

/**
 * Custom error class for API parsing errors with context
 */
export class ParserError extends Error {
    constructor(
        message: string,
        public readonly filePath: string,
        public readonly node?: ts.Node,
        public readonly sourceFile?: ts.SourceFile
    ) {
        super(message)
        this.name = 'ParserError'

        // Add location information if available
        if (node && sourceFile) {
            const {line, character} = sourceFile.getLineAndCharacterOfPosition(node.getStart())
            this.message = `${message}\n  at ${filePath}:${line + 1}:${character + 1}`
        } else {
            this.message = `${message}\n  at ${filePath}`
        }
    }
}

