/**
 * Standardized test runner for code generation tests
 *
 * Provides a one-liner to test code generation:
 * - Loads grest.config.ts from specified path
 * - Runs generation from *.api.ts → *.gen.ts
 * - Compares *.gen.ts with *.expected.ts using V2 block-based comparison
 * - Optionally runs TypeScript compilation on generated files
 */

import * as fs from 'fs'
import * as path from 'path'
import {execSync} from 'child_process'
import {compareCodeV2, formatComparisonV2Result} from '../core/CodeComparer'
import {checkDoubleEmptyLines} from './codeQualityChecks'
import fg from 'fast-glob'
import {runGG} from "./runGG";

export function compareGeneratedCode(testDir: string, configPath: string): void {
    // Find all expected files synchronously
    const fullConfigPath = path.resolve(testDir, configPath)
    const configDir = path.dirname(fullConfigPath)

    // Run code generation before tests in a separate process
    beforeAll(() => {
        runGG(testDir, configPath);
    }, 30000) // 30 second timeout for generation
    const expectedFiles = fg.sync('**/*.expected.ts', {
        cwd: configDir,
        absolute: true,
        ignore: ['**/node_modules/**']
    })

    if (expectedFiles.length === 0) {
        throw new Error(`No .expected.ts files found in ${configDir}`)
    }

    // Find all generated files
    const generatedFiles = fg.sync('**/*.gen.ts', {
        cwd: configDir,
        absolute: true,
        ignore: ['**/node_modules/**']
    })

    // Test: Check for extra generated files (files without matching .expected.ts)
    it('should not generate extra files without matching .expected.ts', () => {
        const extraFiles: string[] = []

        for (const genFile of generatedFiles) {
            const expectedFile = genFile.replace('.gen.ts', '.expected.ts')
            if (!fs.existsSync(expectedFile)) {
                extraFiles.push(path.basename(genFile))
            }
        }

        if (extraFiles.length > 0) {
            throw new Error(
                `Found ${extraFiles.length} generated file(s) without matching .expected.ts:\n` +
                extraFiles.map(f => `  - ${f}`).join('\n') +
                '\n\nEither add .expected.ts files for these or remove them from generation.'
            )
        }
    })

    // Create individual test for each expected file
    expectedFiles.forEach(expectedFile => {
        const generatedFile = expectedFile.replace('.expected.ts', '.gen.ts')
        const fileName = path.basename(generatedFile)

        it(`${fileName} test`, () => {
            // Check if generated file exists
            if (!fs.existsSync(generatedFile)) {
                throw new Error(`Generated file not found: ${generatedFile}`)
            }

            // Quality check
            const content = fs.readFileSync(generatedFile, 'utf-8')
            const qualityResult = checkDoubleEmptyLines(content, generatedFile)
            if (qualityResult.hasIssues) {
                throw new Error(`Quality check failed:\n${qualityResult.issues.join('\n')}`)
            }

            // Read expected file
            const expectedContent = fs.readFileSync(expectedFile, 'utf-8')

            // Compare using V2 block-based comparison
            const comparisonResult = compareCodeV2(expectedContent, content)

            if (!comparisonResult.matches) {
                // Comparison failed - show detailed diff
                const errorMessage = formatComparisonV2Result(comparisonResult)
                throw new Error(`\nComparison failed:\n${errorMessage}`)
            }
        })
    })

    // Test: TypeScript compilation (runs once for all files)
    // Uses test/tsconfig.typecheck.json - a special config for generated code that:
    // - Has no rootDir (allows imports from workspace packages)
    // - Includes DOM lib (for browser packages like @grest-ts/http)
    it('should compile all generated files without TypeScript errors', () => {
        // Use testDir to construct absolute path - vitest may run from workspace root
        const tsconfigPath = path.join(testDir, 'tsconfig.typecheck.json')
        const result = runTscCompilation(testDir, tsconfigPath)
        if (!result.success) {
            throw new Error(result.error)
        }
    })

}

export function runTscCompilation(workingDirectory: string, tsConfigPath: string): { success: boolean; error?: string } {
    try {
        const result = execSync(`npx tsc --project ${tsConfigPath}`, {
            cwd: workingDirectory,
            encoding: 'utf-8'
        })

        // If there's output, it means there were errors/warnings
        if (result && result.trim().length > 0) {
            return {
                success: false,
                error: `TypeScript compilation failed:\n${result}`
            }
        }

        return {success: true}
    } catch (error: any) {
        return {
            success: false,
            error: `TypeScript compilation failed:\n${error.stdout || error.message}`
        }
    }
}

