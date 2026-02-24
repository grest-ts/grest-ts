import * as path from 'path'
import {CodeGeneratorError} from '../core/CodeGeneratorError'

/**
 * Normalize and validate an absolute path
 * Ensures the path is absolute and uses consistent separators
 *
 * @throws Error if path is not absolute
 */
export function validateAndNormalizePath(filePath: string, paramName = 'path'): string {
    if (!path.isAbsolute(filePath)) {
        throw new CodeGeneratorError(
            `${paramName} must be an absolute path, got: ${filePath}\n\n` +
            `  Use path.resolve() or path.join() to create absolute paths.`
        )
    }

    // Normalize the path (resolve .., ., and use consistent separators)
    return path.normalize(filePath)
}
