import * as ts from 'typescript'
import {Project} from '../core/Project'

/**
 * Per-file context passed to builders
 */
export interface FileContext {
    /** Absolute path to the source file */
    filePath: string

    /** TypeScript source file AST */
    sourceFile: ts.SourceFile
}

/**
 * Abstract base class for codegen builders
 *
 * Each package (http, events, etc.) extends this class to handle
 * its specific API definition format.
 *
 * Benefits of class-based approach:
 * - Uses class name as builder name (no separate 'name' property)
 * - Each builder checks if it should handle a file via canHandle()
 * - Each builder checks its own config section (no 'configKey' mapping)
 * - Cleaner, more self-contained design
 */
export abstract class CodegenBuilder {
    /**
     * Check if this builder should handle the given source file
     *
     * Each builder implements its own logic to determine if it should
     * process a file. This replaces the old 'markers' array approach.
     *
     * @param sourceFile - TypeScript source file AST
     * @param project - Shared project (for accessing config)
     * @returns true if this builder should handle the file
     */
    abstract canHandle(sourceFile: ts.SourceFile, project: Project): boolean

    /**
     * Generate code for a file
     *
     * Builders add Files to project. Writing happens at the end
     * after all builders have finished.
     *
     * @param project - Shared project (has typeExtractor, generatorConfig, and collects Files)
     * @param file - Per-file context (filePath, sourceFile)
     */
    abstract generate(project: Project, file: FileContext): Promise<void>

    /**
     * Get the builder name (uses class name)
     */
    get name(): string {
        return this.constructor.name
    }

    protected hasApiCall(sourceFile: ts.SourceFile, functionNames: string[]): boolean {
        const namesSet = new Set(functionNames)
        let found = false

        const visit = (node: ts.Node) => {
            if (found) return // Early exit if already found

            if (ts.isCallExpression(node)) {
                const expr = node.expression
                if (ts.isIdentifier(expr)) {
                    // Direct function call: httpApi(), snsPublisher()
                    if (namesSet.has(expr.text)) {
                        found = true
                        return
                    }
                } else if (ts.isPropertyAccessExpression(expr)) {
                    // Method call on result: httpApi().get() - we want 'httpApi'
                    // Walk up the chain to find the root call
                    let current: ts.Expression = expr
                    while (ts.isPropertyAccessExpression(current) || ts.isCallExpression(current)) {
                        if (ts.isCallExpression(current)) {
                            current = current.expression
                        } else if (ts.isPropertyAccessExpression(current)) {
                            current = current.expression
                        }
                    }
                    if (ts.isIdentifier(current) && namesSet.has(current.text)) {
                        found = true
                        return
                    }
                }
            }
            ts.forEachChild(node, visit)
        }

        visit(sourceFile)
        return found
    }

}
