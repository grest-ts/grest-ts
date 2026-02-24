#!/usr/bin/env tsx

/**
 * Grest Code Generator CLI
 *
 * Searches for grest.config.ts (or .js) in current directory or parent directories
 * and runs code generation based on the configuration.
 */

import * as path from 'path'
import * as fs from 'fs'
import {fileURLToPath, pathToFileURL} from 'url'
import {dirname} from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Search for grest.config.ts or grest.config.js in current directory or parent directories
 * Similar to how tsc searches for tsconfig.json
 */
function findConfigFile(startDir = process.cwd()): string | null {
    let currentDir = path.resolve(startDir)
    const root = path.parse(currentDir).root

    while (true) {
        // Check for .ts first, then .js
        const tsConfigPath = path.join(currentDir, 'grest.config.ts')
        const jsConfigPath = path.join(currentDir, 'grest.config.js')

        if (fs.existsSync(tsConfigPath)) {
            return tsConfigPath
        }
        if (fs.existsSync(jsConfigPath)) {
            return jsConfigPath
        }

        // Move up one directory
        if (currentDir === root) {
            break
        }
        currentDir = path.dirname(currentDir)
    }

    return null
}

/**
 * Load config file dynamically using import()
 */
async function loadConfig(configPath: string): Promise<any> {
    // Use dynamic import for both .ts and .js files
    // tsx handles .ts files automatically
    // Convert Windows path to file:// URL for ES modules
    const configUrl = pathToFileURL(configPath).href
    const configModule = await import(configUrl)
    const config = configModule.default || configModule

    if (!config) {
        throw new Error(`Config file ${configPath} does not export a default configuration`)
    }

    return config
}

/**
 * Main CLI function
 */
async function main() {
    try {
        // Parse --cwd option if provided
        const cwdIndex = process.argv.indexOf('--cwd')
        if (cwdIndex !== -1 && process.argv[cwdIndex + 1]) {
            const targetDir = path.resolve(process.argv[cwdIndex + 1])
            process.chdir(targetDir)
        }

        console.log('🔍 Searching for grest.config.ts...')
        console.log('Current directory:', process.cwd())

        // Find config file
        const configPath = findConfigFile()
        console.log('Found config:', configPath)
        if (!configPath) {
            console.error('❌ Error: Could not find grest.config.ts or grest.config.js in current directory or parent directories.')
            console.error('\nCreate a grest.config.ts file:')
            console.error(`
import { defineConfig } from '@grest-ts/code-generator'

export default defineConfig({
    findPattern: "src/api/**/*.api.ts",
    clientApi: { out: "../client/src/api" },
    serverApi: { out: undefined }
})
            `)
            process.exit(1)
        }

        console.log(`✓ Found config: ${configPath}`)

        // Load config
        const config = await loadConfig(configPath)

        // Set config directory for path resolution
        config._configDir = path.dirname(configPath)

        // Import CodeGenerator from source (tsx handles TypeScript directly)
        const codeGeneratorPath = path.join(__dirname, '../src/codegen/CodeGenerator.ts')
        const {CodeGenerator} = await import(pathToFileURL(codeGeneratorPath).href)

        // Run code generation
        console.log('\n🚀 Starting code generation...\n')
        await CodeGenerator.generate(config)

        console.log('\n✨ Generation complete!')
        process.exit(0)
    } catch (error: any) {
        console.error('\n❌ Error during code generation:')
        console.error(error.message)
        if (error.stack) {
            console.error('\nStack trace:')
            console.error(error.stack)
        }
        process.exit(1)
    }
}

// Run CLI
main()
