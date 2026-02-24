import fg from "fast-glob"
import { readFile } from "fs/promises"
import { dirname, join, relative } from "path"
import { existsSync } from "fs"
import type { GGPackage } from "../definePackage"

/**
 * Parsed information about a GG package.
 * Produced by GGParser, consumed by builders.
 */
export interface GGPackageInfo {
    /** Package name from grest.package.ts, e.g. "@grest-ts/runtime" */
    name: string
    /** Short name without @grest-ts/ prefix, e.g. "runtime" */
    shortName: string
    /** Absolute path to the package directory */
    path: string
    /** Relative path from workspace root to package (e.g. "packages/http" or "packages/events/events") */
    relativePath: string
    /** Depth from workspace root (number of directory levels, e.g. 2 for "packages/http", 3 for "packages/events/events") */
    depth: number
    /** Parsed configuration from grest.package.ts */
    config: GGPackage
    /** All TypeScript source files in src/ */
    sourceFiles: string[]
    /** Discovered imports from source files */
    imports: {
        /** @grest-ts/* package names (without @grest-ts/ prefix) */
        gg: string[]
        /** External npm package names */
        external: string[]
    }
    /** Discovered imports from testkit/ files */
    testkitImports: {
        /** @grest-ts/[pkg]/testkit package names (without @grest-ts/ prefix and /testkit suffix) */
        ggTestkit: string[]
    }
    /** Discovered imports from vitest/ files (these become peerDependencies) */
    vitestImports: {
        /** @grest-ts/* package names (without @grest-ts/ prefix) */
        gg: string[]
    }
    /** Whether test/ directory exists with .ts files */
    hasTestDir: boolean
    /**
     * Entry point mode for the "." export:
     * - "library": single ./src/index.ts (no targets)
     * - "targets": separate ./src/index-node.ts and/or ./src/index-browser.ts based on targets
     */
    entryMode: "library" | "targets"
}

/**
 * Parser that discovers and analyzes GG packages.
 * Finds grest.package.ts files, parses configs, and discovers imports.
 */
export class GGParser {
    constructor(private readonly rootDir: string) {}

    /**
     * Parse all packages in the workspace
     */
    async parse(): Promise<GGPackageInfo[]> {
        const packageFiles = await this.findPackageFiles()

        // Parse all packages in parallel
        const results = await Promise.all(
            packageFiles.map(file => this.parsePackageFile(file))
        )

        // Filter out null results (root configs, parse failures)
        return results.filter((info): info is GGPackageInfo => info !== null)
    }

    /**
     * Parse a single package given its directory and config.
     * Used when running grest.package.ts directly.
     */
    async parseSinglePackage(packageDir: string, config: GGPackage): Promise<GGPackageInfo> {
        return this.buildPackageInfo(packageDir, config)
    }

    /**
     * Find all grest.package.ts files in the workspace
     */
    private async findPackageFiles(): Promise<string[]> {
        return fg("**/grest.package.ts", {
            cwd: this.rootDir,
            absolute: true,
            ignore: ["**/node_modules/**", "**/dist/**"]
        })
    }

    /**
     * Parse a single package from its grest.package.ts file.
     * Returns null for root configs (GGPackageRoot) which have packages[] instead of name/targets.
     */
    private async parsePackageFile(packageFile: string): Promise<GGPackageInfo | null> {
        const packageDir = dirname(packageFile)
        const content = await readFile(packageFile, "utf-8")

        const config = this.parseDefinePackage(content)
        if (!config) {
            console.warn(`Failed to parse ${packageFile}`)
            return null
        }

        // Skip root configs (GGPackageRoot has 'packages' field, not 'name')
        if (!("name" in config) || !("targets" in config)) {
            return null
        }

        return this.buildPackageInfo(packageDir, config)
    }

    /**
     * Build package info from directory and config.
     * Shared logic between parsePackageFile and parseSinglePackage.
     */
    private async buildPackageInfo(packageDir: string, config: GGPackage): Promise<GGPackageInfo> {
        const srcDir = join(packageDir, "src")
        const testDir = join(packageDir, "test")
        const testkitDir = join(packageDir, "testkit")
        const vitestDir = join(packageDir, "vitest")

        // Calculate relative path and depth from workspace root
        const relativePath = relative(this.rootDir, packageDir).replace(/\\/g, "/")
        const depth = relativePath.split("/").filter(Boolean).length

        // Detect entry point mode based on existing files
        const entryMode = this.detectEntryMode(srcDir, config)

        // Find source files and parse imports in parallel
        const [sourceFiles, testkitFiles, vitestFiles, hasTestDir] = await Promise.all([
            existsSync(srcDir)
                ? fg("**/*.ts", { cwd: srcDir, absolute: true, ignore: ["**/*.test.ts", "**/*.spec.ts"] })
                : Promise.resolve([]),
            existsSync(testkitDir)
                ? fg("**/*.ts", { cwd: testkitDir, absolute: true })
                : Promise.resolve([]),
            existsSync(vitestDir)
                ? fg("**/*.ts", { cwd: vitestDir, absolute: true })
                : Promise.resolve([]),
            existsSync(testDir)
                ? fg("**/*.ts", { cwd: testDir }).then(files => files.length > 0)
                : Promise.resolve(false)
        ])

        const [imports, testkitImports, vitestImports] = await Promise.all([
            this.parseImports(sourceFiles),
            this.parseTestkitImports(testkitFiles),
            this.parseVitestImports(vitestFiles)
        ])

        return {
            name: config.name,
            shortName: config.name.replace("@grest-ts/", ""),
            path: packageDir,
            relativePath,
            depth,
            config,
            sourceFiles,
            imports,
            testkitImports,
            vitestImports,
            hasTestDir,
            entryMode
        }
    }

    /**
     * Detect entry mode based on existing files in src/.
     * - If index.ts exists (and no index-node.ts/index-browser.ts) → library mode
     * - If index-node.ts or index-browser.ts exists → targets mode
     * - Mixing is not allowed (index.ts + index-node.ts throws)
     */
    private detectEntryMode(srcDir: string, config: GGPackage): "library" | "targets" {
        const hasIndexTs = existsSync(join(srcDir, "index.ts"))
        const hasIndexNode = existsSync(join(srcDir, "index-node.ts"))
        const hasIndexBrowser = existsSync(join(srcDir, "index-browser.ts"))

        // Validate: no mixing allowed
        if (hasIndexTs && (hasIndexNode || hasIndexBrowser)) {
            throw new Error(
                `Package ${config.name} has both index.ts and index-node.ts/index-browser.ts. ` +
                `Choose one approach: either single index.ts (library mode) or separate target files.`
            )
        }

        // If index.ts exists → library mode
        if (hasIndexTs) {
            return "library"
        }

        // If target files exist → targets mode
        if (hasIndexNode || hasIndexBrowser) {
            return "targets"
        }

        // No entry files exist - check what targets are configured and fail accordingly
        if (config.targets.node || config.targets.browser) {
            const missing: string[] = []
            if (config.targets.node && !hasIndexNode) missing.push("src/index-node.ts")
            if (config.targets.browser && !hasIndexBrowser) missing.push("src/index-browser.ts")
            throw new Error(
                `Package ${config.name} is missing entry files: ${missing.join(", ")}. ` +
                `Either create these files or use a single src/index.ts for library mode.`
            )
        }

        // No targets configured - default to library mode expectation
        throw new Error(
            `Package ${config.name} has no entry point. ` +
            `Create src/index.ts (library mode) or configure targets and create src/index-node.ts/src/index-browser.ts.`
        )
    }

    /**
     * Parse the definePackage call from file content using regex
     */
    private parseDefinePackage(content: string): GGPackage | null {
        // Find the definePackage call and extract its argument
        // This handles multi-line object literals
        const match = content.match(/definePackage\s*\(\s*(\{[\s\S]*\})\s*\)/)
        if (!match) {
            return null
        }

        try {
            // Convert TypeScript object literal to JSON-parseable format
            const objLiteral = match[1]
            const jsonStr = this.objectLiteralToJson(objLiteral)
            return JSON.parse(jsonStr)
        } catch (e) {
            console.warn("Failed to parse definePackage object:", e)
            return null
        }
    }

    /**
     * Convert TypeScript object literal to JSON string
     * Handles: unquoted keys, trailing commas, single quotes, comments
     */
    private objectLiteralToJson(objLiteral: string): string {
        // First, protect existing double-quoted strings by replacing them with placeholders
        const strings: string[] = []
        let json = objLiteral
            // Remove single-line comments (but not inside strings - this is a simple approach)
            .replace(/\/\/.*$/gm, "")
            // Remove multi-line comments
            .replace(/\/\*[\s\S]*?\*\//g, "")

        // Extract and protect double-quoted strings
        json = json.replace(/"([^"\\]|\\.)*"/g, (match) => {
            strings.push(match)
            return `__STRING_${strings.length - 1}__`
        })

        // Now do transformations on the unprotected content
        json = json
            // Quote unquoted keys (handles keys with valid identifier chars)
            // Skip placeholders (__STRING_N__) which are already quoted strings
            .replace(/(\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, (match, ws, key) => {
                if (key.startsWith("__STRING_")) return match // Don't quote placeholders
                return `${ws}"${key}":`
            })
            // Replace single quotes with double quotes (for single-quoted strings)
            .replace(/'([^'\\]|\\.)*'/g, (match) => '"' + match.slice(1, -1) + '"')
            // Remove trailing commas before } or ]
            .replace(/,(\s*[}\]])/g, "$1")
            // Handle 'true' as value (not key)
            .replace(/:\s*true\b/g, ": true")
            // Handle 'false' as value
            .replace(/:\s*false\b/g, ": false")

        // Restore protected strings
        json = json.replace(/__STRING_(\d+)__/g, (_, index) => strings[parseInt(index)])

        return json
    }

    /**
     * Parse imports from source files (parallelized)
     */
    private async parseImports(sourceFiles: string[]): Promise<{ gg: string[], external: string[] }> {
        const ggImports = new Set<string>()
        const externalImports = new Set<string>()

        // Read all files in parallel
        const fileContents = await Promise.all(
            sourceFiles.map(file => readFile(file, "utf-8"))
        )

        for (const content of fileContents) {
            for (const imp of this.extractImports(content)) {
                if (imp.startsWith("@grest-ts/")) {
                    ggImports.add(imp.replace("@grest-ts/", "").split("/")[0])
                } else if (!imp.startsWith(".") && !imp.startsWith("node:")) {
                    // External package - handle scoped packages
                    const pkgName = imp.startsWith("@")
                        ? imp.split("/").slice(0, 2).join("/")
                        : imp.split("/")[0]
                    externalImports.add(pkgName)
                }
            }
        }

        return {
            gg: Array.from(ggImports).sort(),
            external: Array.from(externalImports).sort()
        }
    }

    /**
     * Extract import specifiers from file content
     */
    private extractImports(content: string): string[] {
        const imports: string[] = []

        // Match: import ... from "..." or import "..." or export ... from "..."
        // Requires import/export at start of line (with optional whitespace) to avoid
        // matching "import '...' inside string literals
        // IMPORTANT: Use [^\r\n]* instead of [\s\S]*? to prevent matching across lines
        const importRegex = /^[ \t]*(?:import|export)\s+(?:[^\r\n]*\s+from\s+)?["']([^"']+)["']/gm
        let match
        while ((match = importRegex.exec(content)) !== null) {
            imports.push(match[1])
        }

        // Match: require("...") - but not inside strings
        // Only match if preceded by start of line, =, (, or whitespace
        const requireRegex = /(?:^|[=(,\s])require\s*\(\s*["']([^"']+)["']\s*\)/gm
        while ((match = requireRegex.exec(content)) !== null) {
            imports.push(match[1])
        }

        return imports
    }

    /**
     * Parse testkit imports from testkit/ files.
     * Specifically looks for @grest-ts/[pkg]/testkit imports.
     */
    private async parseTestkitImports(testkitFiles: string[]): Promise<{ ggTestkit: string[] }> {
        const ggTestkitImports = new Set<string>()

        if (testkitFiles.length === 0) {
            return { ggTestkit: [] }
        }

        // Read all files in parallel
        const fileContents = await Promise.all(
            testkitFiles.map(file => readFile(file, "utf-8"))
        )

        for (const content of fileContents) {
            for (const imp of this.extractImports(content)) {
                // Match @grest-ts/*/testkit imports
                const match = imp.match(/^@grest-ts\/([^/]+)\/testkit$/)
                if (match) {
                    ggTestkitImports.add(match[1])
                }
            }
        }

        return {
            ggTestkit: Array.from(ggTestkitImports).sort()
        }
    }

    /**
     * Parse imports from vitest/ files (these become peerDependencies)
     */
    private async parseVitestImports(vitestFiles: string[]): Promise<{ gg: string[] }> {
        const ggImports = new Set<string>()

        if (vitestFiles.length === 0) {
            return { gg: [] }
        }

        // Read all files in parallel
        const fileContents = await Promise.all(
            vitestFiles.map(file => readFile(file, "utf-8"))
        )

        for (const content of fileContents) {
            for (const imp of this.extractImports(content)) {
                // Match @grest-ts/* imports (not subpaths like @grest-ts/*/testkit)
                const match = imp.match(/^@grest-ts\/([^/]+)$/)
                if (match) {
                    ggImports.add(match[1])
                }
            }
        }

        return {
            gg: Array.from(ggImports).sort()
        }
    }
}
