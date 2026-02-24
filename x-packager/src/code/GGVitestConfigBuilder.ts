import { join } from "path"
import { PackagerFile } from "./PackagerFile"
import type { GGPackageInfo } from "./GGParser"
import type { ViteUserConfig } from "vitest/config"

/**
 * Builds vitest.config.ts files for Grest packages.
 * Generates for packages with hasTests or hasCodegenTests.
 */
export class GGVitestConfigBuilder {
    constructor(private readonly packages: GGPackageInfo[]) {}

    /**
     * Check if package needs a vitest config
     */
    private needsVitestConfig(pkg: GGPackageInfo): boolean {
        return !!pkg.config.hasTests || !!pkg.config.hasCodegenTests
    }

    /**
     * Build all vitest.config.ts files
     */
    build(): PackagerFile[] {
        return this.packages
            .filter(pkg => this.needsVitestConfig(pkg))
            .map(pkg => this.buildVitestConfig(pkg))
    }

    /**
     * Build vitest.config.ts for a single package (public API for single-package runs)
     */
    buildForPackage(pkg: GGPackageInfo): PackagerFile[] {
        if (!this.needsVitestConfig(pkg)) return []
        return [this.buildVitestConfig(pkg)]
    }

    /**
     * Build vitest.config.ts for a single package
     */
    private buildVitestConfig(pkg: GGPackageInfo): PackagerFile {
        const customConfig = pkg.config.vitestConfig
        // Calculate relative path to root based on package depth
        const relativeToRoot = "../".repeat(pkg.depth)

        let content: string
        if (customConfig && Object.keys(customConfig).length > 0) {
            // Generate config with custom options merged
            const configStr = this.serializeObject(customConfig)
            content = `import {defineConfig, mergeConfig} from 'vitest/config';
import baseConfig from '${relativeToRoot}vitest.config.base';

export default defineConfig(mergeConfig(
    baseConfig,
    ${configStr}
));
`
        } else {
            // Default minimal config
            content = `import {defineConfig, mergeConfig} from 'vitest/config';
import baseConfig from '${relativeToRoot}vitest.config.base';

export default defineConfig(mergeConfig(baseConfig, {}));
`
        }

        return PackagerFile.text(join(pkg.path, "vitest.config.ts"), content)
    }

    /**
     * Serialize an object to TypeScript code
     */
    private serializeObject(obj: ViteUserConfig | object, indent = 0): string {
        const spaces = "    ".repeat(indent)
        const innerSpaces = "    ".repeat(indent + 1)

        const entries = Object.entries(obj).filter(([, v]) => v !== undefined)
        if (entries.length === 0) return "{}"

        const lines = entries.map(([key, value]) => {
            const serialized = this.serializeValue(value, indent + 1)
            return `${innerSpaces}${key}: ${serialized}`
        })

        return `{\n${lines.join(",\n")}\n${spaces}}`
    }

    /**
     * Serialize a value to TypeScript code
     */
    private serializeValue(value: unknown, indent: number): string {
        if (value === null) return "null"
        if (value === undefined) return "undefined"
        if (typeof value === "boolean") return String(value)
        if (typeof value === "number") return String(value)
        if (typeof value === "string") return JSON.stringify(value)
        if (Array.isArray(value)) {
            const items = value.map(v => this.serializeValue(v, indent))
            return `[${items.join(", ")}]`
        }
        if (typeof value === "object") {
            return this.serializeObject(value as object, indent)
        }
        return String(value)
    }
}
