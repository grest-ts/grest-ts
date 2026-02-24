import { join } from "path"
import { PackagerFile } from "./PackagerFile"
import type { GGPackageInfo } from "./GGParser"

/** tsconfig.json reference entry */
export interface TsConfigReference {
    path: string
}

/** tsconfig.json file structure */
export interface TsConfig {
    extends?: string
    compilerOptions?: {
        rootDir?: string
        types?: string[]
        lib?: string[]
        [key: string]: unknown
    }
    include?: string[]
    exclude?: string[]
    files?: string[]
    references?: TsConfigReference[]
}

/**
 * Builds tsconfig.json files for Grest packages.
 *
 * Generates:
 * - Root tsconfig.json (for grest.package.ts)
 * - src/tsconfig.json (for source files)
 * - test/tsconfig.json (if hasTestsFolder or hasTestDir)
 *
 * Note: No project references are generated (dist-less setup with noEmit: true)
 */
export class GGTsConfigBuilder {
    constructor(private readonly packages: GGPackageInfo[]) {}

    /**
     * Build relative path to tsconfig.base.json from a given depth.
     * @param depth - Number of directory levels from workspace root
     * @param extraLevels - Additional levels (e.g. 1 for src/, test/, testkit/)
     */
    private buildExtendsPath(depth: number, extraLevels: number = 0): string {
        const totalLevels = depth + extraLevels
        return "../".repeat(totalLevels) + "tsconfig.base.json"
    }

    /**
     * Build all tsconfig.json files for all packages
     */
    build(): PackagerFile[] {
        return this.packages.flatMap(pkg => this.buildPackageConfigs(pkg))
    }

    /**
     * Build tsconfig files for a single package (public API for single-package runs)
     */
    buildForPackage(pkg: GGPackageInfo): PackagerFile[] {
        return this.buildPackageConfigs(pkg)
    }

    /**
     * Build tsconfig files for a single package
     */
    private buildPackageConfigs(pkg: GGPackageInfo): PackagerFile[] {
        if (pkg.config.noSourceCode) return []

        const files: PackagerFile[] = []

        // Root tsconfig.json
        files.push(this.buildRootConfig(pkg))

        // src/tsconfig.json
        files.push(this.buildSrcConfig(pkg))

        // test/tsconfig.json (if package has test folder)
        if (pkg.config.hasTestsFolder || pkg.hasTestDir) {
            files.push(this.buildTestConfig(pkg))
        }

        // testkit/tsconfig.json (if package extends @grest-ts/testkit)
        if (pkg.config.extendsTestKit) {
            files.push(this.buildTestkitConfig(pkg))
        }

        // codegen/tsconfig.json (if package extends @grest-ts/code-generator)
        if (pkg.config.extendsCodeGen) {
            files.push(this.buildCodegenConfig(pkg))
        }

        // codegen-test/tsconfig.json (if package has codegen tests)
        if (pkg.config.extendsCodeGen && pkg.config.hasCodegenTests) {
            files.push(this.buildCodegenTestConfig(pkg))
        }

        // tsconfig.publish.json (for building compiled output)
        files.push(this.buildPublishConfig(pkg))

        return files
    }

    /**
     * Build root tsconfig.json for the package
     * This only compiles grest.package.ts
     */
    private buildRootConfig(pkg: GGPackageInfo): PackagerFile {
        const config: TsConfig = {
            extends: this.buildExtendsPath(pkg.depth),
            include: ["grest.package.ts"]
        }

        return PackagerFile.json(join(pkg.path, "tsconfig.json"), config)
    }

    /**
     * Build src/tsconfig.json for source files
     */
    private buildSrcConfig(pkg: GGPackageInfo): PackagerFile {
        // Always specify lib explicitly - add DOM for browser packages
        const lib = pkg.config.targets.browser ? ["ES2022", "DOM"] : ["ES2022"]

        // Build types array based on targets and hasTests
        const needsNodeTypes = !!pkg.config.targets.node
        const usesVitest = !!pkg.config.hasTests
        const types: string[] = []
        if (needsNodeTypes) types.push("node")
        if (usesVitest) types.push("vitest/globals")

        const config: TsConfig = {
            extends: this.buildExtendsPath(pkg.depth, 1), // +1 for src/ subfolder
            compilerOptions: {
                rootDir: ".",
                lib,
                ...(types.length > 0 && { types }),
                // Merge custom compiler options from config
                ...pkg.config.compilerOptions
            },
            include: ["**/*"]
        }

        return PackagerFile.json(join(pkg.path, "src", "tsconfig.json"), config)
    }

    /**
     * Build test/tsconfig.json for test files
     * Note: No rootDir - test files import from ../src which requires rootDir at package level or higher
     */
    private buildTestConfig(pkg: GGPackageInfo): PackagerFile {
        const config: TsConfig = {
            extends: this.buildExtendsPath(pkg.depth, 1), // +1 for test/ subfolder
            compilerOptions: {
                types: ["node", "vitest/globals"]
            },
            include: ["**/*"]
        }

        return PackagerFile.json(join(pkg.path, "test", "tsconfig.json"), config)
    }

    /**
     * Build testkit/tsconfig.json for test framework extensions.
     * These are utilities that extend @grest-ts/testkit and are exported via ./testkit
     * Note: No rootDir - testkit files import from other packages
     */
    private buildTestkitConfig(pkg: GGPackageInfo): PackagerFile {
        const lib = pkg.config.targets.browser ? ["ES2022", "DOM"] : ["ES2022"]

        const config: TsConfig = {
            extends: this.buildExtendsPath(pkg.depth, 1), // +1 for testkit/ subfolder
            compilerOptions: {
                lib,
                types: ["node"]
            },
            include: ["**/*"]
        }

        return PackagerFile.json(join(pkg.path, "testkit", "tsconfig.json"), config)
    }

    /**
     * Build codegen/tsconfig.json for code generation source files.
     * These are utilities that extend @grest-ts/code-generator and are exported via ./codegen
     * Note: No rootDir - codegen files import from other packages
     */
    private buildCodegenConfig(pkg: GGPackageInfo): PackagerFile {
        const config: TsConfig = {
            extends: this.buildExtendsPath(pkg.depth, 1), // +1 for codegen/ subfolder
            compilerOptions: {
                lib: ["ES2022"],
                types: ["node"]
            },
            include: ["**/*"]
        }

        return PackagerFile.json(join(pkg.path, "codegen", "tsconfig.json"), config)
    }

    /**
     * Build codegen-test/tsconfig.json for code generation test files.
     * Note: No rootDir - test files import from ../codegen which requires rootDir at package level or higher
     */
    private buildCodegenTestConfig(pkg: GGPackageInfo): PackagerFile {
        const config: TsConfig = {
            extends: this.buildExtendsPath(pkg.depth, 1), // +1 for codegen-test/ subfolder
            compilerOptions: {
                types: ["node", "vitest/globals"]
            },
            include: ["**/*"]
        }

        return PackagerFile.json(join(pkg.path, "codegen-test", "tsconfig.json"), config)
    }

    /**
     * Build tsconfig.publish.json for npm publishing.
     * Compiles src/ (and optionally testkit/, codegen/) to dist/ with declarations + declaration maps.
     * The declarationMap + shipped source files enable ctrl+click to .ts in consumers' IDEs.
     * This file sits at the package root (no extra level for extends path).
     */
    private buildPublishConfig(pkg: GGPackageInfo): PackagerFile {
        const needsDOM = !!pkg.config.targets.browser
        const lib = needsDOM ? ["ES2022", "DOM"] : ["ES2022"]

        const include = ["src/**/*"]
        if (pkg.config.extendsTestKit) include.push("testkit/**/*")
        if (pkg.config.extendsCodeGen) include.push("codegen/**/*")

        // Testkit code transitively imports @grest-ts/testkit source which uses vitest globals,
        // so we need vitest/globals in types for compilation to succeed in the monorepo.
        const types: string[] = ["node"]
        if (pkg.config.extendsTestKit) types.push("vitest/globals")

        const config: TsConfig = {
            extends: this.buildExtendsPath(pkg.depth),
            compilerOptions: {
                rootDir: ".",
                outDir: "./dist",
                lib,
                types,
                noEmit: false,
                declaration: true,
                declarationMap: true,
                sourceMap: true
            },
            include,
            exclude: ["**/*.test.ts", "**/*.spec.ts"]
        }

        return PackagerFile.json(join(pkg.path, "tsconfig.publish.json"), config)
    }
}
