import type {File} from './File'
import {validateAndNormalizePath} from '../func/validateAndNormalizePath'
import {CodeGeneratorError} from './CodeGeneratorError'
import path from "path";

/**
 * Input for adding an import
 */
export interface FileImportInput {
    absolutePath: string
    name: string
    isType?: boolean
    alias?: string  // Optional alias: import {name as alias} from '...'
}

/**
 * Manages imports for a file
 */
export class FileImports {
    public readonly file: File
    private readonly imports = new Map<string, FileImportInput[]>()

    constructor(file: File) {
        this.file = file
    }

    /**
     * Add an import
     */
    addImport(input: FileImportInput): void {
        // Normalize the import path (if it's a file path, not a library)
        let normalizedPath = input.absolutePath

        // Library imports (like '@grest-ts/http-client') don't need validation
        if (!this.isLibraryImport(input.absolutePath)) {
            // File imports must be absolute and will be normalized
            normalizedPath = validateAndNormalizePath(input.absolutePath, 'import absolutePath')
        }

        // Create normalized input
        const normalizedInput = {
            ...input,
            absolutePath: normalizedPath,
        }

        if (!this.imports.has(normalizedPath)) {
            this.imports.set(normalizedPath, [])
        }

        // Deduplicate: check if this name is already imported from this path
        const existing = this.imports.get(normalizedPath)!
        const alreadyExists = existing.some(imp => imp.name === normalizedInput.name && imp.isType === normalizedInput.isType)
        if (!alreadyExists) {
            existing.push(normalizedInput)
        }
    }

    /**
     * Add SDK shared imports
     * Checks catalogue and redirects individual imports to shared types file
     * Only redirects imports that are actually in the catalogue, not entire file paths
     */
    addSdkSharedImports(sharedTypesFile: File): void {
        // Track individual imports to redirect (not entire file paths)
        const importsToRedirect: { fromPath: string, imp: FileImportInput }[] = []
        const importsToKeep = new Map<string, FileImportInput[]>()

        // Loop over all imports and determine which need redirection
        this.imports.forEach((imports, filePath) => {
            // Skip library imports entirely
            if (this.isLibraryImport(filePath)) {
                importsToKeep.set(filePath, imports)
                return
            }

            // Skip API file imports entirely - they should not be redirected to shared-types
            // API const files are explicitly set and should preserve their paths
            const isApiFile = filePath.includes('/api/') && filePath.endsWith('.gen.ts')
                || filePath.includes('\\api\\') && filePath.endsWith('.gen.ts')
            if (isApiFile) {
                importsToKeep.set(filePath, imports)
                return
            }

            const keptImports: FileImportInput[] = []

            imports.forEach(imp => {
                // Check if this specific import is available in the project catalogue
                const catalogueFile = this.file.project.findInCatalogue(imp.name)

                // Redirect imports to shared-types if the symbol is registered there
                // This handles both type imports AND value imports for classes/enums
                // that are copied to shared-types
                if (catalogueFile && catalogueFile.name === 'shared-types' && catalogueFile !== this.file) {
                    // This import should go to shared-types
                    importsToRedirect.push({fromPath: filePath, imp})
                } else {
                    // Keep this import at original path (not in catalogue or not in shared-types)
                    keptImports.push(imp)
                }
            })

            if (keptImports.length > 0) {
                importsToKeep.set(filePath, keptImports)
            }
        })

        // Rebuild the imports map
        this.imports.clear()

        // Add kept imports (at their original paths)
        for (const [path, imports] of importsToKeep.entries()) {
            this.imports.set(path, imports)
        }

        // Add redirected imports (to shared-types)
        if (importsToRedirect.length > 0) {
            const sharedTypesPath = sharedTypesFile.absolutePath
            if (!this.imports.has(sharedTypesPath)) {
                this.imports.set(sharedTypesPath, [])
            }
            const sharedImports = this.imports.get(sharedTypesPath)!
            for (const {imp} of importsToRedirect) {
                // Avoid duplicates
                if (!sharedImports.some(existing => existing.name === imp.name)) {
                    sharedImports.push(imp)
                }
            }
        }
    }

    /**
     * Generate import statements code
     * Standardized ordering:
     * 1. Library imports (value, then type)
     * 2. File type imports
     * 3. File value imports
     * Within each group: alphabetically by file path, then by import names
     */
    getCode(): string {
        const libraryValueImports = new Map<string, string[]>()
        const libraryTypeImports = new Map<string, string[]>()
        const fileTypeImports = new Map<string, string[]>()
        const fileValueImports = new Map<string, string[]>()

        // Track import names to detect conflicts (same name from different sources)
        const importsByName = new Map<string, Set<string>>()  // name -> Set<absolutePaths>

        const addImport = (name: string, from: string, isType: boolean, isLibrary: boolean, alias?: string) => {
            let map: Map<string, string[]>
            if (isLibrary) {
                map = isType ? libraryTypeImports : libraryValueImports
            } else {
                map = isType ? fileTypeImports : fileValueImports
            }

            if (!map.has(from)) {
                map.set(from, [])
            }

            // Format name with alias if present: "name as alias" or just "name"
            const formattedName = alias ? `${name} as ${alias}` : name

            // Deduplicate: only add if not already in the array
            const names = map.get(from)!
            if (!names.includes(formattedName)) {
                names.push(formattedName)
            }
        }

        this.imports.forEach((imports, filePath) => {
            imports.forEach(imp => {
                // Check if the import path is an API file (api/*.gen.ts) - don't redirect these
                // API const files are explicitly set and should not be redirected to shared-types
                const isApiFile = filePath.includes('/api/') && filePath.endsWith('.gen.ts')
                    || filePath.includes('\\api\\') && filePath.endsWith('.gen.ts')

                // Check catalogue for actual location (skip for API files)
                // Redirect ALL imports (type and value) to shared-types if available
                // This ensures classes and other values are imported from shared-types
                const catalogueFile = isApiFile ? null : this.file.project.findInCatalogue(imp.name)
                const actualPath = catalogueFile
                    ? catalogueFile.absolutePath
                    : filePath

                // Skip self-imports (importing from the same file we're generating)
                if (this.isSelfImport(actualPath)) {
                    return // Skip this import
                }

                // Track this import for conflict detection (only for file imports, not libraries)
                if (!this.isLibraryImport(actualPath)) {
                    if (!importsByName.has(imp.name)) {
                        importsByName.set(imp.name, new Set())
                    }
                    importsByName.get(imp.name)!.add(actualPath)
                }

                // Check if actualPath is already a library/package name (hardcoded in generators)
                // Library names don't contain path separators and don't start with '.'
                const isAlreadyLibraryName = this.isLibraryImport(actualPath)

                let importPath: string
                if (isAlreadyLibraryName) {
                    // Already a library name like '@grest-ts/validator' - use as-is
                    importPath = actualPath
                } else {
                    // Filesystem path - use ImportPathResolver to determine the import specifier
                    // This handles library imports (node_modules, workspace packages) and local files
                    importPath = this.file.project.importPathResolver.resolve(
                        this.file.absolutePath,
                        actualPath
                    )
                }

                // Check if it's a library import (starts with package name, not './')
                const isLibrary = this.isLibraryImport(importPath)

                addImport(imp.name, importPath, imp.isType || false, isLibrary, imp.alias)
            })
        })

        // Check for import conflicts (same name from different source files)
        importsByName.forEach((sources, name) => {
            if (sources.size > 1) {
                throw new CodeGeneratorError(
                    `Import conflict: Type '${name}' is defined in multiple files:\n` +
                    Array.from(sources).map(s => `    - ${s}`).join('\n') +
                    `\n\n  Please rename one of these types to avoid the conflict.`,
                    {filePath: this.file.absolutePath}
                )
            }
        })

        // Deduplicate: Remove type imports if the same name is imported as value
        // If we have: import {Foo} and import type {Foo}, we only need import {Foo}
        const deduplicateTypeImports = (valueMap: Map<string, string[]>, typeMap: Map<string, string[]>) => {
            for (const [path, typeNames] of typeMap.entries()) {
                const valueNames = valueMap.get(path)
                if (valueNames) {
                    // Remove any type imports that are already value imports
                    const filtered = typeNames.filter(name => !valueNames.includes(name))
                    if (filtered.length === 0) {
                        typeMap.delete(path)
                    } else {
                        typeMap.set(path, filtered)
                    }
                }
            }
        }

        // Apply deduplication for both library and file imports
        deduplicateTypeImports(libraryValueImports, libraryTypeImports)
        deduplicateTypeImports(fileValueImports, fileTypeImports)

        const code: string[] = []

        // Helper to generate import statements from a map
        const generateImports = (map: Map<string, string[]>, isType: boolean) => {
            // Sort by file path
            const sortedPaths = Array.from(map.keys()).sort()

            for (const importPath of sortedPaths) {
                const names = map.get(importPath)!
                // Sort import names alphabetically
                names.sort()

                const importPrefix = isType ? 'import type' : 'import'
                // No spaces in curly braces: {GGHttpClient, ...}
                code.push(`${importPrefix} {${names.join(', ')}} from '${importPath}'\n`)
            }
        }

        // 1. Library value imports
        generateImports(libraryValueImports, false)

        // 2. Library type imports
        generateImports(libraryTypeImports, true)

        // 3. File type imports
        generateImports(fileTypeImports, true)

        // 4. File value imports
        generateImports(fileValueImports, false)

        return code.length > 0 ? code.join('') + '\n' : ''
    }

    /**
     * Check if this is a self-import (importing from the same file)
     * Self-imports should be skipped since the type is already in this file
     *
     * Assumes paths are already normalized when added to the system
     */
    private isSelfImport(importPath: string): boolean {
        // Library imports can't be self-imports
        if (this.isLibraryImport(importPath)) {
            return false
        }

        // Direct comparison (paths should already be normalized)
        return importPath === this.file.absolutePath
    }

    /**
     * Check if this is a library/package import (not a file path)
     * Library imports don't start with . or / (e.g., '@grest-ts/http-client', 'react')
     * Also checks for absolute paths (which are file paths, not library imports)
     */
    private isLibraryImport(importPath: string): boolean {
        // Absolute paths are file imports, not library imports
        if (path.isAbsolute(importPath)) {
            return false
        }

        // Library imports don't start with . or /
        return !importPath.startsWith('.') && !importPath.startsWith('/')
    }

}
