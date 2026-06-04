import * as ts from 'typescript'

/**
 * Custom error class for API parsing errors with context
 */
export class ParserError extends Error {
    public readonly filePath: string
    public readonly node?: ts.Node
    public readonly sourceFile?: ts.SourceFile
    constructor(
        message: string,
        filePath: string,
        node?: ts.Node,
        sourceFile?: ts.SourceFile
    ) {
        super(message)
        this.filePath = filePath
        this.node = node
        this.sourceFile = sourceFile
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

