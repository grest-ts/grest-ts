import * as fs from 'fs'
import * as path from 'path'

/**
 * Resolves import paths, determining whether to use:
 * - Package names for library/workspace imports (@grest-ts/validator, lodash, etc.)
 * - Relative paths for local project files
 *
 * Initialized once and caches all workspace package information for performance.
 */
export class ImportPathResolver {
    private workspacePackages: Map<string, string> = new Map() // absolute path prefix → package name
    private nodeModulesCache: Map<string, string> = new Map()  // absolute file path → package name
    private projectRoot: string

    constructor(projectRoot: string) {
        this.projectRoot = path.resolve(projectRoot)
        this.scanWorkspacePackages()
    }

    /**
     * Scan for all workspace packages and build a map of paths to package names
     */
    private scanWorkspacePackages(): void {
        // Find workspace root by looking for package.json with "workspaces" field
        const workspaceRoot = this.findWorkspaceRoot(this.projectRoot)
        if (!workspaceRoot) {
            return
        }

        // Read root package.json to find workspace patterns
        const rootPackageJsonPath = path.join(workspaceRoot, 'package.json')
        if (!fs.existsSync(rootPackageJsonPath)) {
            return
        }

        const rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, 'utf-8'))
        const workspaces = rootPackageJson.workspaces

        if (!workspaces) {
            return
        }

        // workspaces can be an array or an object with "packages" field
        const workspacePatterns: string[] = Array.isArray(workspaces)
            ? workspaces
            : workspaces.packages || []



        // For each workspace pattern, find matching directories
        for (const pattern of workspacePatterns) {
            // Simple glob expansion - just handle "*" at the end
            if (pattern.endsWith('/*')) {
                const baseDir = path.join(workspaceRoot, pattern.slice(0, -2))
                if (fs.existsSync(baseDir)) {
                    const entries = fs.readdirSync(baseDir, { withFileTypes: true })
                    for (const entry of entries) {
                        if (entry.isDirectory()) {
                            const packageDir = path.join(baseDir, entry.name)
                            this.registerPackage(packageDir)
                        }
                    }
                }
            } else {
                // Direct package path
                const packageDir = path.join(workspaceRoot, pattern)
                if (fs.existsSync(packageDir)) {
                    this.registerPackage(packageDir)
                }
            }
        }


    }

    /**
     * Register a package directory by reading its package.json
     */
    private registerPackage(packageDir: string): void {
        const packageJsonPath = path.join(packageDir, 'package.json')
        if (!fs.existsSync(packageJsonPath)) {
            return
        }

        try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
            if (packageJson.name) {
                const normalizedPath = path.resolve(packageDir)
                this.workspacePackages.set(normalizedPath, packageJson.name)
            }
        } catch (error) {
            // Ignore invalid package.json files
        }
    }

    /**
     * Find workspace root by walking up looking for package.json with "workspaces"
     */
    private findWorkspaceRoot(startPath: string): string | null {
        let currentPath = path.resolve(startPath)

        while (true) {
            const packageJsonPath = path.join(currentPath, 'package.json')
            if (fs.existsSync(packageJsonPath)) {
                try {
                    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
                    if (packageJson.workspaces) {
                        return currentPath
                    }
                } catch (error) {
                    // Ignore invalid package.json
                }
            }

            const parentPath = path.dirname(currentPath)
            if (parentPath === currentPath) {
                // Reached filesystem root
                return null
            }
            currentPath = parentPath
        }
    }

    /**
     * Resolve import path from one file to another
     * Returns package name for libraries, relative path for local files
     */
    resolve(fromFile: string, toFile: string): string {
        const normalizedToFile = path.resolve(toFile)
        const normalizedFromFile = path.resolve(fromFile)

        // 1. Check if it's from node_modules
        if (normalizedToFile.includes('node_modules')) {
            const cached = this.nodeModulesCache.get(normalizedToFile)
            if (cached) {
                return cached
            }

            const packageName = this.extractPackageNameFromNodeModules(normalizedToFile)
            if (packageName) {
                this.nodeModulesCache.set(normalizedToFile, packageName)

                return packageName
            }
        }

        // 2. Check if it's from a workspace package
        const packageName = this.findWorkspacePackageForFile(normalizedToFile)
        if (packageName) {
            // Only use package name if it's a different package than the fromFile
            const fromPackageName = this.findWorkspacePackageForFile(normalizedFromFile)

            if (packageName !== fromPackageName) {

                return packageName
            }
        }

        // 3. Fall back to relative path for local files in same package
        const relativePath = this.resolveRelativePath(normalizedFromFile, normalizedToFile)

        return relativePath
    }

    /**
     * Extract package name from node_modules path
     * Examples:
     *   /path/node_modules/@grest-ts/validator/dist/IsEmail.js → @grest-ts/validator
     *   /path/node_modules/lodash/index.js → lodash
     */
    private extractPackageNameFromNodeModules(filePath: string): string | null {
        const parts = filePath.split(path.sep)
        const nodeModulesIndex = parts.lastIndexOf('node_modules')

        if (nodeModulesIndex === -1 || nodeModulesIndex >= parts.length - 1) {
            return null
        }

        const afterNodeModules = parts[nodeModulesIndex + 1]

        // Check if it's a scoped package (@scope/package)
        if (afterNodeModules.startsWith('@')) {
            if (nodeModulesIndex >= parts.length - 2) {
                return null
            }
            return `${afterNodeModules}/${parts[nodeModulesIndex + 2]}`
        }

        // Regular package
        return afterNodeModules
    }

    /**
     * Find which workspace package a file belongs to
     */
    private findWorkspacePackageForFile(filePath: string): string | null {
        const normalizedPath = path.resolve(filePath)

        // Find the longest matching prefix
        let bestMatch: string | null = null
        let bestMatchLength = 0

        for (const [packagePath, packageName] of this.workspacePackages.entries()) {
            // Normalize packagePath for comparison (handle Windows paths)
            const normalizedPackagePath = path.resolve(packagePath)
            const startsWithPackagePath = normalizedPath.startsWith(normalizedPackagePath + path.sep) || normalizedPath === normalizedPackagePath

            if (startsWithPackagePath) {
                if (normalizedPackagePath.length > bestMatchLength) {
                    bestMatch = packageName
                    bestMatchLength = normalizedPackagePath.length
                }
            }
        }

        if (filePath.includes('validator') || filePath.includes('http')) {

        }

        return bestMatch
    }

    /**
     * Create relative import path between two files
     * Removes file extension and handles index files
     */
    private resolveRelativePath(fromFile: string, toFile: string): string {
        const fromDir = path.dirname(fromFile)
        let relativePath = path.relative(fromDir, toFile)

        // Convert Windows paths to Unix style
        relativePath = relativePath.replace(/\\/g, '/')

        // Remove file extension
        relativePath = relativePath.replace(/\.(ts|tsx|js|jsx|d\.ts)$/, '')

        // Ensure relative paths start with ./ or ../
        if (!relativePath.startsWith('.')) {
            relativePath = './' + relativePath
        }

        return relativePath
    }
}
