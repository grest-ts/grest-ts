import { join, dirname } from "path"
import { existsSync, readFileSync } from "fs"
import { GGParser, type GGPackageInfo } from "./GGParser"
import { GGTsConfigBuilder, type TsConfig } from "./GGTsConfigBuilder"
import { GGPackageBuilder, type PackageJsonRootMeta } from "./GGPackageBuilder"
import { GGVitestConfigBuilder } from "./GGVitestConfigBuilder"
import { GGMermaidBuilder } from "./GGMermaidBuilder"
import { GGDependencyJsonBuilder } from "./GGDependencyJsonBuilder"
import { GGImportFixer } from "./GGImportFixer"
import { GGCircularDependencyChecker } from "./GGCircularDependencyChecker"
import { GGAllowedPackagesChecker } from "./GGAllowedPackagesChecker"
import { PackagerFile } from "./PackagerFile"
import type {GGPackage, GGPackageRoot} from "../definePackage"

/**
 * Find the workspace root by walking up from packageDir
 * looking for a root grest.package.ts (one with GGPackageRoot config)
 */
function findWorkspaceRoot(startDir: string): string {
    let dir = startDir
    while (dir !== dirname(dir)) {
        // Check for root indicator: grest.package.ts at this level with packages/ subdir
        const hasRootPackageTs = existsSync(join(dir, "grest.package.ts"))
        const hasPackagesDir = existsSync(join(dir, "packages"))
        if (hasRootPackageTs && hasPackagesDir) {
            return dir
        }
        dir = dirname(dir)
    }
    // Fallback to start directory
    return startDir
}

export interface GGPackagerOptions {
    /** Root directory of the workspace */
    rootDir: string
    /** Root packager config from gg.packager.ts */
    rootConfig?: GGPackageRoot
    /** Generate tsconfig.json files */
    tsconfig?: boolean
    /** Generate package.json files */
    packageJson?: boolean
    /** Dry run - don't write files, just return them */
    dryRun?: boolean
}

export interface GGPackagerResult {
    /** All packages found */
    packages: GGPackageInfo[]
    /** Files that were/would be written */
    files: PackagerFile[]
}

/**
 * Write files and log results
 */
async function writeFiles(files: PackagerFile[], dryRun: boolean): Promise<void> {
    if (dryRun) {
        console.log(`🔍 Dry run: would check ${files.length} file(s)`)
        for (const file of files) {
            console.log(`   ${file.path}`)
        }
        return
    }

    if (files.length === 0) return

    console.log(`✏️  Checking ${files.length} file(s)...`)
    const results = await Promise.all(files.map(f => f.write()))
    const written = results.filter(r => r).length
    console.log(`✅ Done! (${written} written, ${results.length - written} unchanged)`)
}

/**
 * Main orchestrator for Grest package generation.
 * Parses packages and generates tsconfig.json and package.json files.
 */
export class GGPackager {
    constructor(private readonly options: GGPackagerOptions) {}

    /**
     * Run the packager
     */
    async run(): Promise<GGPackagerResult> {
        const { rootDir, rootConfig, tsconfig = true, packageJson = true, dryRun = false } = this.options

        // Parse all packages
        console.log("🔍 Scanning for packages...")
        const parser = new GGParser(rootDir)
        const packages = await parser.parse()
        console.log(`   Found ${packages.length} package(s)`)

        // Check for circular dependencies (throws error if found)
        console.log("🔄 Checking for circular dependencies...")
        new GGCircularDependencyChecker(packages).check()

        // Check for disallowed package imports (throws error if found)
        console.log("🔒 Checking allowed packages...")
        new GGAllowedPackagesChecker(packages).check()

        // Fix invalid imports
        console.log("🔧 Checking imports...")
        const importFixer = new GGImportFixer(packages)
        const fixes = await importFixer.fix()
        if (fixes.length > 0) {
            console.log(`   Fixed ${fixes.length} import(s):`)
            for (const fix of fixes) {
                console.log(`   - ${fix.reason}`)
            }
        }

        // Read version from root package.json
        const rootPackageJsonPath = join(rootDir, "package.json")
        const rootPackageJson = existsSync(rootPackageJsonPath)
            ? JSON.parse(readFileSync(rootPackageJsonPath, "utf-8"))
            : {}
        const rootMeta: PackageJsonRootMeta = {
            version: rootPackageJson.version ?? "0.0.0",
            license: rootPackageJson.license ?? "MIT",
            repository: rootPackageJson.repository,
            bugs: rootPackageJson.bugs,
            keywords: rootPackageJson.keywords,
            engines: rootPackageJson.engines,
        }

        // Read root LICENSE file for copying into packages
        const rootLicensePath = join(rootDir, "LICENSE")
        const rootLicense = existsSync(rootLicensePath)
            ? readFileSync(rootLicensePath, "utf-8")
            : null

        // Collect all files to write
        const files: PackagerFile[] = []

        if (tsconfig) {
            console.log("📝 Generating tsconfig.json files...")
            files.push(...new GGTsConfigBuilder(packages).build())

            if (rootConfig) {
                files.push(this.buildRootTsConfig(packages, rootConfig))
            }
        }

        if (packageJson) {
            console.log("📦 Generating package.json files...")
            files.push(...new GGPackageBuilder(packages, rootMeta).build())

            // Update root package.json workspaces
            if (rootConfig) {
                console.log("📦 Updating root package.json workspaces...")
                files.push(this.buildRootPackageJson(packages, rootConfig))
            }
        }

        // Copy root LICENSE into each package
        if (rootLicense) {
            console.log("📄 Copying LICENSE files...")
            for (const pkg of packages) {
                files.push(PackagerFile.copy(join(pkg.path, "LICENSE"), rootLicense))
            }
        }

        // Generate vitest.config.ts for packages with hasTests
        console.log("🧪 Generating vitest.config.ts files...")
        files.push(...new GGVitestConfigBuilder(packages).build())

        // Generate dependency diagram
        if (rootConfig?.dependenciesGraphOut) {
            console.log("📊 Generating dependency diagram...")
            files.push(new GGMermaidBuilder(packages, rootDir, rootConfig.dependenciesGraphOut).build())
            files.push(new GGDependencyJsonBuilder(packages, rootDir).build())
        }

        // Generate vitest.config.ts at root level (vitest 4 format with projects)
        if (rootConfig) {
            console.log("🧪 Generating vitest.config.ts...")
            files.push(this.buildVitestConfig(packages, rootConfig))
        }

        await writeFiles(files, dryRun)
        return { packages, files }
    }

    /**
     * Build the root package.json with auto-detected workspaces
     */
    private buildRootPackageJson(packages: GGPackageInfo[], rootConfig: GGPackageRoot): PackagerFile {
        const { rootDir } = this.options
        const rootPackageJsonPath = join(rootDir, "package.json")

        // Read existing package.json
        const existingContent = existsSync(rootPackageJsonPath)
            ? JSON.parse(readFileSync(rootPackageJsonPath, "utf-8"))
            : {}

        // Build workspace patterns from discovered packages
        const workspaces = this.buildWorkspacePatterns(packages)

        // Update workspaces field
        const updatedContent = {
            ...existingContent,
            workspaces
        }

        return PackagerFile.json(rootPackageJsonPath, updatedContent)
    }

    /**
     * Build optimal workspace patterns from discovered packages.
     * Groups packages by parent directory and creates glob patterns.
     */
    private buildWorkspacePatterns(packages: GGPackageInfo[]): string[] {
        // Group packages by their parent directory
        const byParent = new Map<string, string[]>()

        const rootLevelPackages: string[] = []

        for (const pkg of packages) {
            const parts = pkg.relativePath.split("/")
            if (parts.length >= 2) {
                // Has parent directory (e.g., "packages/http" -> parent is "packages")
                const parent = parts.slice(0, -1).join("/")
                const existing = byParent.get(parent) || []
                existing.push(pkg.relativePath)
                byParent.set(parent, existing)
            } else {
                // Root-level package (e.g., "x-packager")
                rootLevelPackages.push(pkg.relativePath)
            }
        }

        // Generate patterns
        const patterns = new Set<string>()

        for (const [parent, pkgPaths] of byParent) {
            // Check if this parent has multiple packages (should use glob)
            // or if packages are at different depths under this parent
            const depths = new Set(pkgPaths.map(p => p.split("/").length))

            if (pkgPaths.length > 1 || depths.size > 1) {
                // Multiple packages or mixed depths - use glob pattern
                patterns.add(`${parent}/*`)
            } else {
                // Single package - add it directly
                patterns.add(pkgPaths[0])
            }
        }

        // Also check for deeper nesting (packages/trace/trace-http)
        // If we have packages/trace/* but also packages/http, we need both patterns
        const finalPatterns = new Set<string>()

        for (const pattern of patterns) {
            // Check if any package path requires this pattern
            const matchesAny = packages.some(pkg => {
                if (pattern.endsWith("/*")) {
                    const prefix = pattern.slice(0, -2)
                    return pkg.relativePath.startsWith(prefix + "/")
                }
                return pkg.relativePath === pattern
            })

            if (matchesAny) {
                finalPatterns.add(pattern)
            }
        }

        // Add root-level packages directly
        for (const pkg of rootLevelPackages) {
            finalPatterns.add(pkg)
        }

        // Add exports/* if it exists
        if (existsSync(join(this.options.rootDir, "exports"))) {
            finalPatterns.add("exports/*")
        }

        return Array.from(finalPatterns).sort()
    }

    /**
     * Build the root tsconfig.json that includes all packages for unified typecheck
     */
    private buildRootTsConfig(packages: GGPackageInfo[], rootConfig: GGPackageRoot): PackagerFile {
        const { rootDir } = this.options

        // Build include patterns from actual package paths (supports nested packages)
        const packageIncludes = new Set<string>()
        for (const pkg of packages) {
            // Add src, test, testkit patterns for each package
            packageIncludes.add(`${pkg.relativePath}/src/**/*`)
            if (pkg.config.hasTestsFolder || pkg.hasTestDir) {
                packageIncludes.add(`${pkg.relativePath}/test/**/*`)
            }
            if (pkg.config.extendsTestKit) {
                packageIncludes.add(`${pkg.relativePath}/testkit/**/*`)
            }
            // Add codegen folders if package extends code-generator
            if (pkg.config.extendsCodeGen) {
                packageIncludes.add(`${pkg.relativePath}/codegen/**/*`)
                if (pkg.config.hasCodegenTests) {
                    packageIncludes.add(`${pkg.relativePath}/codegen-test/**/*`)
                }
            }
        }

        const includes = [
            "grest.package.ts",
            ...Array.from(packageIncludes).sort(),
            "exports/*/**/*"
        ]

        const config: TsConfig = {
            extends: "./tsconfig.base.json",
            compilerOptions: {
                lib: ["ES2022", "DOM"],
                types: ["node", "vitest/globals"]
            },
            include: includes
        }

        return PackagerFile.json(join(rootDir, "tsconfig.json"), config)
    }

    /**
     * Build the vitest.config.ts file with projects (vitest 4 format)
     */
    private buildVitestConfig(packages: GGPackageInfo[], rootConfig: GGPackageRoot): PackagerFile {
        const { rootDir } = this.options

        // Filter packages that have tests (regular or codegen), use relativePath for correct nesting
        const packagesWithTests = packages
            .filter(pkg => pkg.config.hasTests || pkg.config.hasCodegenTests)
            .map(pkg => pkg.relativePath)
            .sort()

        // Add extra entries from root config
        const extraEntries = rootConfig.vitestWorkspaceExtraEntries ?? []

        const allEntries = [...packagesWithTests, ...extraEntries]

        // Vitest 4 uses defineConfig with projects instead of defineWorkspace
        const content = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    projects: [
${allEntries.map(p => `      '${p}'`).join(',\n')}
    ]
  }
})
`

        return PackagerFile.text(join(rootDir, "vitest.config.ts"), content)
    }

    /**
     * Static helper to run the packager
     */
    static async run(options: GGPackagerOptions): Promise<GGPackagerResult> {
        return new GGPackager(options).run()
    }

    /**
     * Run the packager for a single package.
     * Parses all packages in workspace for correct dependency resolution,
     * but only generates files for the target package.
     */
    static async runSinglePackage(packageDir: string, config: GGPackage): Promise<void> {
        // Find workspace root by looking for root grest.package.ts
        const rootDir = findWorkspaceRoot(packageDir)

        // Parse all packages for context (needed for isNodeOnly checks, references, etc.)
        console.log("🔍 Scanning workspace for context...")
        const parser = new GGParser(rootDir)
        const allPackages = await parser.parse()

        // Find or create the target package info
        const shortName = config.name.replace("@grest-ts/", "")
        let targetPackage = allPackages.find(p => p.shortName === shortName)

        if (!targetPackage) {
            // Package not in workspace yet, parse it directly
            targetPackage = await parser.parseSinglePackage(packageDir, config)
            allPackages.push(targetPackage)
        }

        // Read version from root package.json
        const rootPackageJsonPath = join(rootDir, "package.json")
        const rootPackageJson = existsSync(rootPackageJsonPath)
            ? JSON.parse(readFileSync(rootPackageJsonPath, "utf-8"))
            : {}
        const rootMeta: PackageJsonRootMeta = {
            version: rootPackageJson.version ?? "0.0.0",
            license: rootPackageJson.license ?? "MIT",
            repository: rootPackageJson.repository,
            bugs: rootPackageJson.bugs,
            keywords: rootPackageJson.keywords,
            engines: rootPackageJson.engines,
        }

        // Read root LICENSE file for copying into package
        const rootLicensePath = join(rootDir, "LICENSE")
        const rootLicense = existsSync(rootLicensePath)
            ? readFileSync(rootLicensePath, "utf-8")
            : null

        console.log(`📦 Generating files for ${config.name}...`)

        // Generate files using all packages for context, but only output target's files
        const tsConfigBuilder = new GGTsConfigBuilder(allPackages)
        const packageBuilder = new GGPackageBuilder(allPackages, rootMeta)
        const vitestBuilder = new GGVitestConfigBuilder(allPackages)

        const files: PackagerFile[] = [
            ...tsConfigBuilder.buildForPackage(targetPackage),
            ...packageBuilder.buildForPackage(targetPackage),
            ...vitestBuilder.buildForPackage(targetPackage)
        ]

        // Copy root LICENSE into the package
        if (rootLicense) {
            files.push(PackagerFile.copy(join(targetPackage.path, "LICENSE"), rootLicense))
        }

        await writeFiles(files, false)
    }

    /**
     * Run the packager for all packages in the workspace.
     */
    static async runPackageRoot(rootDir: string, config: GGPackageRoot): Promise<void> {
        await new GGPackager({ rootDir, rootConfig: config }).run()
    }
}
