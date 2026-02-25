import type { GGPackageInfo } from "./GGParser"

/**
 * Validates that packages only import from their allowed @grest-ts/* dependencies.
 * When a package has `allowedPackages` configured, only those packages may be imported.
 */
export class GGAllowedPackagesChecker {
    constructor(private readonly packages: GGPackageInfo[]) {}

    /**
     * Check for disallowed package imports and throw an error if found.
     */
    check(): void {
        const violations: { pkg: string, disallowed: string[], allowed: string[] }[] = []

        for (const pkg of this.packages) {
            const allowed = pkg.config.allowedPackages

            // Skip if allowedPackages is not configured
            if (allowed === undefined) {
                continue
            }

            // Get all @grest-ts/* imports (short names without @grest-ts/ prefix)
            const imports = pkg.imports.gg.filter(imp =>
                imp !== pkg.shortName // Exclude self
            )

            // Find imports that are not in the allowed list
            const disallowed = imports.filter(imp => !allowed.includes(`@grest-ts/${imp}`))

            if (disallowed.length > 0) {
                violations.push({
                    pkg: pkg.name,
                    disallowed: disallowed.map(d => `@grest-ts/${d}`),
                    allowed
                })
            }
        }

        if (violations.length > 0) {
            const messages = violations.map(v => {
                const allowedStr = v.allowed.length === 0
                    ? "no @grest-ts/* packages"
                    : v.allowed.join(", ")
                return `  ${v.pkg}:\n    Disallowed: ${v.disallowed.join(", ")}\n    Allowed: ${allowedStr}`
            }).join("\n\n")

            throw new Error(
                `Package import restrictions violated:\n\n${messages}\n\n` +
                `Please remove disallowed imports or update allowedPackages in grest.package.ts.`
            )
        }
    }
}
