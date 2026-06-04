import {join} from "path"
import {PackagerFile} from "./PackagerFile"
import type {GGPackageInfo} from "./GGParser"

/** package.json exports entry */
export interface PackageJsonExport {
    types: string
    import: string
}

/** Conditional exports entry (browser/default conditions) */
export interface PackageJsonConditionalExport {
    browser: PackageJsonExport
    default: PackageJsonExport
}

/** Root-level metadata read from the workspace root package.json */
export interface PackageJsonRootMeta {
    version: string
    license: string
    repository?: { type: string; url: string }
    bugs?: { url: string }
    keywords?: string[]
    engines?: Record<string, string>
}

/** package.json file structure */
export interface PackageJson {
    name: string
    version: string
    type: "module"
    license: string
    description: string
    private?: boolean
    publishConfig?: { access: "public" }
    repository?: { type: string; url: string; directory: string }
    homepage?: string
    bugs?: { url: string }
    keywords?: string[]
    engines?: Record<string, string>
    exports?: Record<string, PackageJsonExport | PackageJsonConditionalExport>
    files: string[]
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    bin?: string | Record<string, string>
}

/**
 * Builds package.json files for Grest packages.
 */
export class GGPackageBuilder {
    /** Map of package short names to their info */
    private packageMap: Map<string, GGPackageInfo>
    private readonly packages: GGPackageInfo[]
    private readonly rootMeta: PackageJsonRootMeta

    constructor(packages: GGPackageInfo[], rootMeta: PackageJsonRootMeta) {
        this.packages = packages
        this.rootMeta = rootMeta
        this.packageMap = new Map(packages.map(p => [p.shortName, p]))
    }

    /**
     * Build all package.json files
     */
    build(): PackagerFile[] {
        return this.packages.map(pkg => this.buildPackageJson(pkg))
    }

    /**
     * Build package.json for a single package (public API for single-package runs)
     */
    buildForPackage(pkg: GGPackageInfo): PackagerFile[] {
        return [this.buildPackageJson(pkg)]
    }

    /**
     * Build package.json for a single package
     */
    private buildPackageJson(pkg: GGPackageInfo): PackagerFile {
        const {version, license, repository, bugs, keywords, engines} = this.rootMeta

        const noSrc = pkg.config.noSourceCode

        const packageJson: PackageJson = {
            name: pkg.config.name,
            version,
            type: "module",
            license,
            description: pkg.config.description,
            ...(!noSrc && { exports: this.buildExports(pkg) }),
            files: noSrc ? noSrc.files : this.buildFiles(pkg),
            ...(!noSrc && { scripts: this.buildScripts(pkg) }),
        }

        // Mark as private unless explicitly opted-in to npm publishing
        if (!pkg.config.publishToNpm) {
            packageJson.private = true
        } else {
            packageJson.publishConfig = {access: "public"}
        }

        // Add repository, homepage, bugs, keywords, engines from root
        if (repository) {
            packageJson.repository = {...repository, directory: pkg.relativePath}
            packageJson.homepage = `https://grest-ts.com/packages/${pkg.shortName}`
        }
        if (bugs) packageJson.bugs = bugs
        const mergedKeywords = [...(keywords ?? []), ...(pkg.config.keywords ?? [])]
        if (mergedKeywords.length > 0) packageJson.keywords = [...new Set(mergedKeywords)]
        if (engines) packageJson.engines = engines

        // Add bin if specified
        if (noSrc?.bin) {
            packageJson.bin = noSrc.bin
        } else if (pkg.config.bin) {
            packageJson.bin = pkg.config.bin
        }

        // Add dependencies (regular deps for node-only, or browser-compatible deps)
        const {dependencies, peerDependencies} = this.buildDependencies(pkg)
        if (Object.keys(dependencies).length > 0) {
            packageJson.dependencies = dependencies
        }

        // Add peerDependencies (node-only deps when package has browser target)
        if (Object.keys(peerDependencies).length > 0) {
            packageJson.peerDependencies = peerDependencies
        }

        // Add devDependencies
        const devDeps = this.buildDevDependencies(pkg)
        if (Object.keys(devDeps).length > 0) {
            packageJson.devDependencies = devDeps
        }

        return PackagerFile.json(join(pkg.path, "package.json"), packageJson)
    }

    /**
     * Build exports field based on entry mode and targets.
     * All exports point to TypeScript source files directly.
     * Runtime uses tsx to execute TypeScript - no compilation needed.
     */
    private buildExports(pkg: GGPackageInfo): Record<string, PackageJsonExport | PackageJsonConditionalExport> {
        const exports: Record<string, PackageJsonExport | PackageJsonConditionalExport> = {}
        const targets = pkg.config.targets

        if (pkg.entryMode === "library") {
            // Library mode: single ./src/index.ts entry point
            exports["."] = {
                types: "./src/index.ts",
                import: "./src/index.ts"
            }
        } else if (targets.node && targets.browser) {
            // Both targets: use conditional exports so bundlers (Vite) pick browser
            // automatically via the "browser" condition, and Node.js falls through to "default"
            exports["."] = {
                browser: {
                    types: "./src/index-browser.ts",
                    import: "./src/index-browser.ts"
                },
                default: {
                    types: "./src/index-node.ts",
                    import: "./src/index-node.ts"
                }
            }
        } else if (targets.node) {
            // Node-only target
            exports["."] = {
                types: "./src/index-node.ts",
                import: "./src/index-node.ts"
            }
        } else if (targets.browser) {
            // Browser-only target
            exports["."] = {
                types: "./src/index-browser.ts",
                import: "./src/index-browser.ts"
            }
        }

        // Optional override: point the `.` entry's `types` condition at a
        // dedicated `.d.ts` file so it resolves cleanly in source mode (no
        // `.ts → .d.ts` extension stripping). `import` stays on the runtime
        // entry. Used by @grest-ts/testkit-vitest for its generated
        // extensions.d.ts aggregator.
        if (pkg.config.typesOverride) {
            const entry = exports["."]
            if (entry && "types" in entry && "import" in entry) {
                exports["."] = {types: pkg.config.typesOverride, import: entry.import}
            } else if (entry) {
                // Conditional shape (browser/default) — override types in each branch.
                const overridden: Record<string, any> = {}
                for (const [cond, value] of Object.entries(entry)) {
                    if (value && typeof value === "object" && "types" in value && "import" in value) {
                        overridden[cond] = {types: pkg.config.typesOverride, import: (value as any).import}
                    } else {
                        overridden[cond] = value
                    }
                }
                exports["."] = overridden as PackageJsonConditionalExport
            }
        }

        // Custom exports from config
        if (pkg.config.customExports) {
            for (const [exportPath, filePath] of Object.entries(pkg.config.customExports)) {
                exports[exportPath] = {
                    types: filePath,
                    import: filePath
                }
            }
        }

        // Testkit extension -> "./testkit" export
        if (pkg.config.extendsTestKit) {
            exports["./testkit"] = {
                types: "./testkit/index-testkit.ts",
                import: "./testkit/index-testkit.ts"
            }
        }

        // CodeGen extension -> "./codegen" export
        if (pkg.config.extendsCodeGen) {
            exports["./codegen"] = {
                types: "./codegen/index-codegen.ts",
                import: "./codegen/index-codegen.ts"
            }
        }

        return exports
    }

    /**
     * Build standard scripts.
     * No build step needed - tsx runs TypeScript directly.
     */
    private buildScripts(pkg: GGPackageInfo): Record<string, string> {
        // Typecheck src, and also test folder if it exists
        const hasTestFolder = pkg.config.hasTestsFolder || pkg.hasTestDir
        const typecheck = hasTestFolder
            ? "tsc --noEmit -p src && tsc --noEmit -p test"
            : "tsc --noEmit -p src"

        const scripts: Record<string, string> = {
            typecheck
        }

        // Add test scripts only if package uses vitest
        if (pkg.config.hasTests) {
            scripts.test = "vitest run"
            scripts["test:coverage"] = "vitest run --coverage"
            scripts["test:coverage:html"] = "vitest run --coverage --reporter=html"
        }

        // Add custom scripts from config (can override standard scripts)
        if (pkg.config.scripts) {
            Object.assign(scripts, pkg.config.scripts)
        }

        return scripts
    }

    /**
     * Build dependencies from external imports + config.
     *
     * Policy: every internal @grest-ts/* cross-dep is emitted as a
     * peerDependency at the exact workspace version. This prevents npm/pnpm
     * from installing two physical copies of a state-bearing package when a
     * consumer's transitive graph would otherwise hoist conflicting versions
     * — duplicate loads break async context, validation registries, and
     * service discovery (caught at runtime by each package's _dedupCheck).
     *
     * External (non-@grest-ts) deps stay where the package config puts them.
     */
    private buildDependencies(pkg: GGPackageInfo): { dependencies: Record<string, string>, peerDependencies: Record<string, string> } {
        const deps: Record<string, string> = {}
        const peerDeps: Record<string, string> = {}

        // Every @grest-ts/* cross-dep from discovered imports → peerDependency
        for (const ggImport of pkg.imports.gg) {
            if (ggImport === pkg.shortName) continue
            if (this.packageMap.has(ggImport)) {
                peerDeps[`@grest-ts/${ggImport}`] = this.rootMeta.version
            }
        }

        // Same for explicit references (imports the parser couldn't auto-detect)
        if (pkg.config.references) {
            for (const ref of pkg.config.references) {
                if (ref === pkg.shortName) continue
                if (this.packageMap.has(ref)) {
                    peerDeps[`@grest-ts/${ref}`] = this.rootMeta.version
                }
            }
        }

        // External (non-@grest-ts) dependencies from config
        if (pkg.config.dependencies) {
            this.validateNoGGPackages(pkg.name, "dependencies", pkg.config.dependencies)
            Object.assign(deps, pkg.config.dependencies)
        }

        // External (non-@grest-ts) peerDependencies from config
        if (pkg.config.peerDependencies) {
            this.validateNoGGPackages(pkg.name, "peerDependencies", pkg.config.peerDependencies)
            Object.assign(peerDeps, pkg.config.peerDependencies)
        }

        // @grest-ts/* imports from vitest/ folder are peerDependencies
        // (consumer-supplied during testing)
        for (const ggImport of pkg.vitestImports.gg) {
            const pkgName = `@grest-ts/${ggImport}`
            if (ggImport !== pkg.shortName && this.packageMap.has(ggImport)) {
                peerDeps[pkgName] = this.rootMeta.version
            }
        }

        return {
            dependencies: this.sortObject(deps),
            peerDependencies: this.sortObject(peerDeps)
        }
    }

    /**
     * Build devDependencies
     */
    private buildDevDependencies(pkg: GGPackageInfo): Record<string, string> {
        const devDeps: Record<string, string> = {}

        // Add @grest-ts/code-generator when package extends codegen
        if (pkg.config.extendsCodeGen) {
            devDeps["@grest-ts/code-generator"] = this.rootMeta.version
        }

        // Add @grest-ts/testkit when package extends testkit (for testing, not runtime)
        if (pkg.config.extendsTestKit) {
            devDeps["@grest-ts/testkit"] = this.rootMeta.version
        }

        // Add external devDependencies from config
        if (pkg.config.devDependencies) {
            this.validateNoGGPackages(pkg.name, "devDependencies", pkg.config.devDependencies)
            Object.assign(devDeps, pkg.config.devDependencies)
        }

        return this.sortObject(devDeps)
    }

    /**
     * Build files array for package.json.
     * Only source files - no compiled dist folders.
     */
    private buildFiles(pkg: GGPackageInfo): string[] {
        const files = ["src"]

        if (pkg.config.bin) {
            files.unshift("bin")
        }

        if (pkg.config.extendsTestKit) {
            files.push("testkit")
        }

        if (pkg.config.extendsCodeGen) {
            files.push("codegen")
        }

        if (pkg.config.extraFiles) {
            files.push(...pkg.config.extraFiles)
        }

        return files
    }

    /**
     * Validate that no @grest-ts/* packages are listed in explicit dependency configs.
     * Internal @grest-ts/* dependencies are auto-discovered from imports.
     */
    private validateNoGGPackages(pkgName: string, field: string, deps: Record<string, string>): void {
        const ggDeps = Object.keys(deps).filter(dep => dep.startsWith("@grest-ts/"))
        if (ggDeps.length > 0) {
            throw new Error(
                `${pkgName} has @grest-ts/* packages in "${field}": ${ggDeps.join(", ")}\n` +
                `@grest-ts/* dependencies are auto-discovered from imports and should not be listed manually.\n` +
                `Remove them from "${field}" in grest.package.ts.`
            )
        }
    }

    /**
     * Sort object keys alphabetically
     */
    private sortObject(obj: Record<string, string>): Record<string, string> {
        const sorted: Record<string, string> = {}
        for (const key of Object.keys(obj).sort()) {
            sorted[key] = obj[key]
        }
        return sorted
    }
}
