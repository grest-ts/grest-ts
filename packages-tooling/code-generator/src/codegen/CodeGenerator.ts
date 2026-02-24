/**
 * Modular Code Generator
 *
 * This is a thin orchestrator that:
 * 1. Discovers codegen modules via GGExtensionDiscovery('codegen')
 * 2. Creates a shared Project
 * 3. Scans for API definition files
 * 4. Dispatches to registered builders based on file markers
 * 5. Writes all generated files at the end
 *
 * All API-specific logic lives in the respective packages:
 * - @grest-ts/http/codegen - HTTP and WebSocket APIs
 * - @grest-ts/events/codegen - Event/SNS APIs
 */

import fg from 'fast-glob'
import path from 'path'
import {GGExtensionDiscovery} from '@grest-ts/common'
import {TypeExtractor} from '../core/TypeExtractor'
import {GeneratorConfig, Project} from '../core/Project'
import {CodeGeneratorError} from '../core/CodeGeneratorError'
import {type FileContext,} from './CodegenBuilder'
import {CodegenRegistry} from "./CodegenRegistry";

/**
 * Apply default values to config
 */
function applyDefaults(config: GeneratorConfig): GeneratorConfig {
    return {
        findPattern: '**/*.api.ts',
        generatedFileSuffix: '.gen',
        allowNull: false,
        skipLibCheck: false,
        exportValidators: false,
        ...config,
    }
}

export class CodeGenerator {
    /**
     * Main generation method
     *
     * @param config Configuration object from grest.config.ts
     * @returns Array of all generated file paths
     */
    public static async generate(config: GeneratorConfig): Promise<string[]> {
        const overallStartTime = performance.now()

        // Apply defaults
        config = applyDefaults(config)

        // 1. Discover and load all codegen modules
        console.log('🔍 Discovering codegen modules...')
        const discovery = new GGExtensionDiscovery('codegen')
        await discovery.load()

        const builders = CodegenRegistry.getBuilders()
        if (builders.length === 0) {
            console.log('⚠️  No codegen builders registered. Make sure packages have codegen/index-codegen.ts')
            return []
        }
        console.log(`📦 Loaded ${builders.length} builder(s): ${builders.map(b => b.name).join(', ')}`)

        // 2. Find all API files
        const searchOptions = {
            absolute: true,
            ignore: ['**/node_modules/**', '**/dist/**'],
            cwd: config._configDir || process.cwd(),
        }

        const apiFiles = fg.sync(config.findPattern!, searchOptions) as string[]

        if (apiFiles.length === 0) {
            console.log(`No files found matching: ${config.findPattern}`)
            return []
        }
        console.log(`📄 Found ${apiFiles.length} API file(s)`)

        // 3. Create shared TypeExtractor and Project
        const typeExtractorStartTime = performance.now()
        const typeExtractor = new TypeExtractor(apiFiles, {skipLibCheck: config.skipLibCheck})
        const typeExtractorDuration = performance.now() - typeExtractorStartTime
        console.log(`⏱️  TypeExtractor creation: ${typeExtractorDuration.toFixed(2)}ms`)

        // Create the central Project
        const project = new Project({
            targetDir: config._configDir || process.cwd(),
            typeExtractor,
            generatorConfig: config,
        })

        // 4. Process each file
        let hasErrors = false

        for (const filePath of apiFiles) {
            try {
                // Get source file from project
                const sourceFile = project.getSourceFile(filePath)

                if (!sourceFile) {
                    console.log(`⚠️  Could not get source file: ${filePath}`)
                    continue
                }

                // Find builders that can handle this file
                // Each builder checks if it should handle the file via canHandle()
                const matchedBuilders = CodegenRegistry.getBuilders().filter(builder => builder.canHandle(sourceFile, project))

                if (matchedBuilders.length === 0) {
                    continue // No builder wants to handle this file
                }

                // Create file context
                const fileCtx: FileContext = {
                    filePath,
                    sourceFile,
                }

                // Let each matched builder generate (they add Files to project)
                for (const builder of matchedBuilders) {
                    const builderStartTime = performance.now()

                    await builder.generate(project, fileCtx)

                    const builderDuration = performance.now() - builderStartTime
                    console.log(`✓ ${builder.name}: ${path.basename(filePath)} (${builderDuration.toFixed(2)}ms)`)
                }
            } catch (error: any) {
                console.log(`✗ Error processing ${filePath}: ${error.message}`)
                console.log(error.stack)
                hasErrors = true
            }
        }

        if (hasErrors) {
            throw new CodeGeneratorError(
                'Generation completed with errors\n\n' +
                '  Check the error messages above for details on which files failed.'
            )
        }

        // 6. Write all files at once
        console.log('\n📝 Writing generated files...')
        await project.write()

        // Get list of written files (from project's internal file list)
        const generatedFiles = (project as any).files?.map((f: any) => f.absolutePath) || []

        const overallDuration = performance.now() - overallStartTime
        console.log(`\n${'='.repeat(60)}`)
        console.log(`✅ Generated ${generatedFiles.length} file(s) in ${(overallDuration / 1000).toFixed(2)}s`)
        console.log('='.repeat(60))

        return generatedFiles
    }
}
