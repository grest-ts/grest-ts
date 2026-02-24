import { join } from "path"
import { existsSync, readFileSync } from "fs"
import { PackagerFile } from "./PackagerFile"
import type { GGPackageInfo } from "./GGParser"

const BANNER_START = "<!-- GREST-TS-BANNER-START -->"
const BANNER_END = "<!-- GREST-TS-BANNER-END -->"

const BANNER_CONTENT = `${BANNER_START}
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
${BANNER_END}`

/**
 * Manages README banners for published packages.
 * Ensures each package README has a banner linking to the parent framework.
 */
export class GGReadmeBannerBuilder {
    constructor(private readonly packages: GGPackageInfo[]) {}

    /**
     * Build banner-updated READMEs for all non-hidden packages
     */
    build(): PackagerFile[] {
        return this.packages
            .filter(pkg => !pkg.config.hidden)
            .flatMap(pkg => this.buildForPackage(pkg))
    }

    /**
     * Build banner-updated README for a single package
     */
    buildForPackage(pkg: GGPackageInfo): PackagerFile[] {
        if (pkg.config.hidden) return []

        const readmePath = join(pkg.path, "README.md")
        const existing = existsSync(readmePath) ? readFileSync(readmePath, "utf-8") : ""
        const updated = this.applyBanner(existing)

        return [PackagerFile.copy(readmePath, updated)]
    }

    /**
     * Apply the banner to README content.
     * Replaces existing sentinel block or prepends if not found.
     */
    private applyBanner(content: string): string {
        const startIdx = content.indexOf(BANNER_START)
        const endIdx = content.indexOf(BANNER_END)

        if (startIdx !== -1 && endIdx !== -1) {
            // Replace existing banner block (inclusive of sentinels)
            const before = content.substring(0, startIdx)
            const after = content.substring(endIdx + BANNER_END.length)
            return before + BANNER_CONTENT + after
        }

        // Prepend banner with a blank line before existing content
        return BANNER_CONTENT + "\n\n" + content
    }
}
