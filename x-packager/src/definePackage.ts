import {GGPackager} from "./code/GGPackager"
import type {ViteUserConfig} from "vitest/config"

export interface GGPackage {
    /**
     * Package name, e.g. "@grest-ts/runtime"
     */
    name: string

    /**
     * Package description
     */
    description: string

    /**
     * If true, the package will be published to npm as a public package.
     * Packages without this flag (or set to false) get "private": true in their generated package.json.
     */
    publishToNpm?: boolean;

    /**
     * Add if the package is experimental and hidden from the public.
     */
    hidden?: boolean;

    /**
     * Adds vitest config
     */
    hasTests?: boolean,

    /**
     * Adds test folder with necessary config to the package
     */
    hasTestsFolder?: boolean;

    /**
     * Custom vitest configuration to merge with base config.
     * Only used when hasTests is true.
     */
    vitestConfig?: ViteUserConfig

    /**
     * If this package contains extensions for the GGTest framework
     */
    extendsTestKit?: boolean;

    /**
     * If this package contains extensions for @grest-ts/code-generator.
     * Adds ./codegen export pointing to codegen/src/index-codegen.ts
     */
    extendsCodeGen?: boolean;

    /**
     * If the codegen folder has a test subfolder with tests.
     * Only used when extendsCodeGen is true.
     */
    hasCodegenTests?: boolean;

    /**
     * If this package literally implements a strategy for some main package. This value is used for documentation building.
     */
    implementationFor?: string

    targets: {
        /**
         * src/index-node.ts is the entry file name.
         * Adds "." to the exports
         */
        node?: true,
        /**
         * src/index-browser.ts is the entry file name.
         * Adds "./browser" to the exports
         */
        browser?: true
    }

    /**
     * Only these gg packages are allowed. If any other is discovered, it will fail.
     * Only used if the value is set, an empty array is "none allowed".
     */
    allowedPackages?: string[]

    /**
     * External npm dependencies (NOT @grest-ts/* packages - those are auto-discovered)
     */
    dependencies?: Record<string, string>

    /**
     * External npm peer dependencies (e.g., optional native modules like "ws")
     */
    peerDependencies?: Record<string, string>

    /**
     * External npm dev dependencies
     */
    devDependencies?: Record<string, string>

    /**
     * CLI binary entry points.
     * Maps command name to script path, e.g. { "grest": "./bin/grest.js" }
     */
    bin?: Record<string, string>

    /**
     * Additional @grest-ts/* package references to add.
     * Use this when a package uses another package via strings (e.g., code generation)
     * that can't be auto-discovered from imports.
     * Specify short names without @grest-ts/ prefix, e.g. ["http", "validator"]
     */
    references?: string[]

    /**
     * Custom exports to add to package.json.
     * Use this for package-specific exports that aren't covered by standard targets.
     * Maps export path to source file path, e.g. { "./mockable": "./src/mockable/mockable.ts" }
     */
    customExports?: Record<string, string>

    /**
     * Custom scripts to add to package.json.
     * These are merged with standard scripts (typecheck, test).
     * e.g. { "benchmark": "tsx src/benchmark.ts" }
     */
    scripts?: Record<string, string>

    /**
     * Package-specific keywords to merge with root package.json keywords.
     * Root keywords are always included; these are additional keywords specific to this package.
     */
    keywords?: string[]

    /**
     * Custom TypeScript compiler options to add to src/tsconfig.json.
     * These are merged with standard options (rootDir, lib, types).
     * e.g. { "strict": true }
     */
    compilerOptions?: Record<string, unknown>

    /**
     * Marks this package as having no TypeScript source code.
     * The packager will still generate package.json (with root metadata),
     * but skips exports, tsconfig, vitest config, and source scanning.
     * Used for CLI tools like create-grest-ts that ship plain .mjs + templates.
     */
    noSourceCode?: {
        /** CLI binary entry point, e.g. "./index.mjs" */
        bin?: string
        /** Files to include in the published package */
        files: string[]
    }
}

export interface GGPackageRoot {
    /**
     * Directories containing packages.
     * Currently unused - packages are auto-discovered via glob.
     * Reserved for future filtering functionality.
     */
    packages: string[]

    /**
     * Additional tsconfig references to include in root tsconfig.json
     */
    additionalReferences?: string[]

    vitestWorkspaceExtraEntries?: string[]

    /**
     * Output path for the dependencies graph markdown file.
     * e.g. "docs/DEPENDENCIES.md"
     */
    dependenciesGraphOut?: string
}

/**
 * Define a GG package configuration.
 * Auto-runs when executed directly via `npx tsx grest.package.ts`.
 *
 * @example
 * ```typescript
 * import { definePackage } from "@grest-ts/x-packager";
 *
 * definePackage({
 *     name: "@grest-ts/common",
 *     description: "Common utilities",
 *     targets: { node: true }
 * });
 * ```
 */
export function definePackage(pkg: GGPackage | GGPackageRoot): GGPackage | GGPackageRoot {
    const mainModule = process.argv?.[1]
    if (mainModule?.endsWith("grest.package.ts") || mainModule?.endsWith("grest.x-packager.ts")) {
        if (isPackageRoot(pkg)) {
            GGPackager.runPackageRoot(process.cwd(), pkg)
        } else if (isSinglePackage(pkg)) {
            GGPackager.runSinglePackage(process.cwd(), pkg)
        } else {
            console.error("Invalid config!")
        }
    }
    return pkg
}

function isPackageRoot(pkg: GGPackage | GGPackageRoot): pkg is GGPackageRoot {
    return "packages" in pkg && !isSinglePackage(pkg)
}

function isSinglePackage(pkg: GGPackage | GGPackageRoot): pkg is GGPackage {
    return ("targets" in pkg || "noSourceCode" in pkg) && "name" in pkg && "description" in pkg
}
