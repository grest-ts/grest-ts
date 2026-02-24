import {ParsedType} from './ParsedType'
import {TypeExtractor} from "./TypeExtractor";

/**
 * Lazy type resolver with opportunistic caching
 * Parses types on-demand as generators request them
 * When parsing a file, caches ALL types found in that file (not just the requested one)
 * This avoids re-parsing the same file multiple times
 */
export class TypeResolver {
    private cache = new Map<string, ParsedType>() // Key format: "sourceFilePath:typeName"
    private fileCache = new Set<string>() // Track which files we've already bulk-cached
    private extractor: TypeExtractor // Will be actual TypeExtractor when copied

    constructor(extractor: TypeExtractor) {
        this.extractor = extractor
    }

    /**
     * Get cache key for a type (scoped by source file to avoid collisions)
     */
    private getCacheKey(typeName: string, sourceFilePath: string): string {
        return `${sourceFilePath}:${typeName}`
    }

    /**
     * Resolve a type on-demand with opportunistic caching
     * When we parse a file for one type, we cache ALL types from that file
     * This prevents re-parsing the same file multiple times
     */
    resolve(typeName: string): ParsedType | undefined {
        // Parse on-demand using TypeExtractor
        // TypeExtractor will find the correct source file and use its own cache
        const parsed = this.extractor.resolveType(typeName)

        if (!parsed) {
            return undefined
        }

        const sourceFile = parsed.sourcePath || ''

        // Get file-scoped cache key
        const cacheKey = this.getCacheKey(typeName, sourceFile)

        // Check cache with file-scoped key
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey)
        }

        // Cache the requested type with file-scoped key
        this.cacheType(typeName, parsed)

        // Opportunistic caching: If we haven't bulk-cached this file yet,
        // cache ALL types from it (since TypeExtractor already parsed the whole file)
        if (sourceFile && !this.fileCache.has(sourceFile)) {
            this.cacheAllTypesFromFile(sourceFile)
            this.fileCache.add(sourceFile)
        }

        return this.cache.get(cacheKey)
    }

    /**
     * Resolve type and all its dependencies recursively
     * Useful for generating validators or copying types to SDK
     *
     * Note: This extracts dependencies by analyzing the type structure
     */
    resolveWithDependencies(typeName: string): ParsedType[] {
        const result: ParsedType[] = []
        const visited = new Set<string>()

        const visit = (type: ParsedType) => {
            const key = type.name || JSON.stringify(type)
            if (visited.has(key)) return
            visited.add(key)

            result.push(type)

            // Extract dependencies from type structure
            if (type.properties) {
                Object.values(type.properties).forEach(prop => {
                    if (prop.typeName && !this.isPrimitive(prop.typeName)) {
                        const depType = this.resolve(prop.typeName)
                        if (depType) visit(depType)
                    }
                })
            }

            if (type.unionTypes) {
                type.unionTypes.forEach(t => visit(t))
            }

            if (type.elementType) {
                visit(type.elementType)
            }
        }

        const rootType = this.resolve(typeName)
        if (rootType) {
            visit(rootType)
        }

        return result
    }

    /**
     * Check if a type name is a primitive
     */
    private isPrimitive(typeName: string): boolean {
        return ['string', 'number', 'boolean', 'any', 'void', 'unknown', 'undefined', 'null'].includes(typeName)
    }

    /**
     * Cache all types from a source file
     * TypeExtractor has already parsed the file, so this is essentially free
     */
    private cacheAllTypesFromFile(sourceFile: string): void {
        // Get all types from this file
        // TypeExtractor.getAllTypesFromFile() returns all exports from the file
        const allTypes =
            (this.extractor.getAllTypesFromFile &&
                this.extractor.getAllTypesFromFile(sourceFile)) ||
            []

        for (const type of allTypes) {
            const typeName = type.name || ''
            if (typeName && !this.cache.has(typeName)) {
                this.cacheType(typeName, type)
            }
        }
    }

    /**
     * Helper to cache a single type
     * Simply stores what TypeExtractor returns - no normalization
     */
    private cacheType(typeName: string, parsed: ParsedType): void {
        const sourceFile = parsed.sourcePath || ''
        const cacheKey = this.getCacheKey(typeName, sourceFile)

        // Trust TypeExtractor to return correct kinds
        // If kinds are wrong, fix TypeExtractor, not here!
        this.cache.set(cacheKey, {
            name: parsed.name || typeName,
            ...parsed, // Pass through everything from TypeExtractor
        })
    }
}
