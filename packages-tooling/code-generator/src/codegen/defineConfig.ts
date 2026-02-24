import * as path from 'path'
import {GeneratorConfig} from '../core/Project'

/**
 * Define generator configuration
 *
 * This function:
 * 1. Validates and returns the config (for type safety)
 * 2. Auto-executes the code generator when the config file is run directly via tsx/IDE
 *
 * @param config - Generator configuration object
 * @returns The same config object (passthrough for type safety)
 */
// Track if we've already started execution to prevent multiple runs
let executionStarted = false

export function defineConfig(config: GeneratorConfig): GeneratorConfig {
    // Auto-execute when config file is run directly
    // This allows users to run `tsx grest.config.ts` or use IDE run buttons
    if (isRunDirectly() && !executionStarted) {
        executionStarted = true

        // Set config directory to the location of the grest.config.ts file
        const configFile = process.argv[1]
        if (configFile) {
            config._configDir = path.dirname(configFile)
        }

        // Use setImmediate to ensure the config is fully exported before execution
        setImmediate(async () => {
            try {
                // Dynamic import to avoid circular dependencies
                const {CodeGenerator} = await import('./CodeGenerator.js')
                console.log('🚀 Running code generator...')
                const files = await CodeGenerator.generate(config)
                console.log(`✅ Generated ${files.length} files`)
                process.exit(0)
            } catch (err) {
                console.error('❌ Generation failed:', err)
                process.exit(1)
            }
        })
    }

    return config
}

/**
 * Detect if this config file is being run directly (not imported)
 */
function isRunDirectly(): boolean {
    // Check if running via tsx or node with the config file as entry point
    const mainModule = process.argv[1]
    if (!mainModule) return false

    // Match common config file names
    return mainModule.endsWith('grest.config.ts') ||
           mainModule.endsWith('grest.config.js') ||
           mainModule.endsWith('grest.config.mjs')
}
