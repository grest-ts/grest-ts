import * as path from 'path'
import * as ts from 'typescript'
import {File} from './File'
import {ImportPathResolver} from './ImportPathResolver'
import {CodeGeneratorError} from './CodeGeneratorError'
import type {TypeExtractor} from './TypeExtractor'

/**
 * Generator configuration (for codegen)
 * Extended by each codegen module via declaration merging
 */
export interface GeneratorConfig {
    findPattern?: string
    generatedFileSuffix?: string
    allowNull?: boolean
    skipLibCheck?: boolean
    exportValidators?: boolean
    _configDir?: string
}

/**
 * Project configuration
 */
export interface ProjectConfig {
    /**
     * Root directory where files will be written
     */
    targetDir: string
    /**
     * Relative path to shared types file (for SDK builds)
     */
    sharedTypesFile?: string
    /**
     * Shared TypeExtractor for type resolution (for codegen)
     */
    typeExtractor?: TypeExtractor
    /**
     * Generator config (for codegen)
     */
    generatorConfig?: GeneratorConfig
}

/**
 * Base class for a code generation project
 * Manages files, chunks, and provides catalogue-based import resolution
 */
export class Project {
    public readonly config: ProjectConfig
    public readonly importPathResolver: ImportPathResolver
    public readonly typeExtractor?: TypeExtractor
    public readonly generatorConfig?: GeneratorConfig
    private readonly files: File[] = []
    /**
     * Catalogue: Maps exported names to the files that export them
     * This enables automatic import resolution
     */
    private readonly catalogue = new Map<string, File>()

    constructor(config: ProjectConfig) {
        this.config = config
        this.typeExtractor = config.typeExtractor
        this.generatorConfig = config.generatorConfig
        // Initialize import path resolver (scans workspace once for all package names)
        this.importPathResolver = new ImportPathResolver(config.targetDir)
    }

    /**
     * Get source file from TypeExtractor
     * Convenience method for codegen builders
     */
    getSourceFile(filePath: string): ts.SourceFile | undefined {
        if (!this.typeExtractor) {
            return undefined
        }
        this.typeExtractor.setSourceFile(filePath)
        return (this.typeExtractor as any).sourceFile
    }

    /**
     * Add an export to the catalogue
     * This allows other files to import it automatically
     */
    addToCatalogue(file: File, name: string): void {
        const existing = this.catalogue.get(name)
        if (existing) {
            if (existing.absolutePath === file.absolutePath) {
                // Same file trying to register same name again - this is OK, just skip
                return
            }
            // Different file trying to use the same name - this is an error
            throw new CodeGeneratorError(
                `Cannot add '${name}' to catalogue.\n` +
                `  Already exists in: ${existing.absolutePath}\n` +
                `  Trying to add from: ${file.absolutePath}\n\n` +
                `  Please rename one of these to avoid the conflict.`,
                {filePath: file.absolutePath}
            )
        }
        this.catalogue.set(name, file)
    }

    /**
     * Find which file exports a given name
     */
    findInCatalogue(name: string): File | undefined {
        return this.catalogue.get(name)
    }

    /**
     * Internal: Add file to project
     * Called by File constructor
     */
    _addFile(file: File): void {
        this.files.push(file)
    }

    /**
     * Write all files to disk
     */
    async write(): Promise<void> {
        // Phase 1: Resolve all imports via catalogue
        this.resolveImports()

        // Phase 2: Write all files
        await Promise.all(this.files.map(file => file.write()))
    }

    /**
     * Resolve imports for all files
     * For SDK mode, redirects imports to shared types file
     */
    private resolveImports(): void {
        if (this.config.sharedTypesFile) {
            // SDK mode: Create shared types file for cross-file imports
            const sharedTypesPath = path.normalize(path.join(
                this.config.targetDir,
                this.config.sharedTypesFile
            ))

            // Check if shared types file already exists in the project
            let sharedTypesFile = this.files.find(f => f.absolutePath === sharedTypesPath)

            // Only create if it doesn't exist yet
            if (!sharedTypesFile) {
                sharedTypesFile = new File(
                    this,
                    sharedTypesPath,
                    'shared-types'
                )
            }

            this.files.forEach(file => file.imports.addSdkSharedImports(sharedTypesFile))
        }
    }
}
