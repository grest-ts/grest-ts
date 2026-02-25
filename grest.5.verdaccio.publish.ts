// Publishes all packages from the dist/ staging area to a local Verdaccio registry.
// Expects dist/ to already be built via `tsx grest.build.ts`.
// Uses prerelease versions (e.g., 1.0.219-verdaccio.3) so the main version is never affected.
// Queries Verdaccio for the latest prerelease number and auto-increments it.
// Usage: tsx grest.5.verdaccio.publish.ts [--dry-run]
import {readFileSync, writeFileSync} from "fs"
import {join} from "path"
import {discoverBuiltPackages, publishParallel, validateDependencies} from "./x-packager/src/publish-helpers"

const REGISTRY = "http://localhost:4873"

/** Query Verdaccio for the next prerelease number for a given base version */
async function getNextPrereleaseNumber(packageName: string, baseVersion: string): Promise<number> {
    try {
        const res = await fetch(`${REGISTRY}/${packageName}`, {timeout: 5000} as any)
        if (!res.ok) return 1

        const data = await res.json() as { versions?: Record<string, unknown> }
        if (!data.versions) return 1

        const prefix = `${baseVersion}-verdaccio.`
        let max = 0
        for (const ver of Object.keys(data.versions)) {
            if (ver.startsWith(prefix)) {
                const n = parseInt(ver.slice(prefix.length), 10)
                if (n > max) max = n
            }
        }
        return max + 1
    } catch {
        return 1
    }
}

/** Update version and all @grest-ts/* dependency versions in a package.json file */
function updatePackageVersion(pkgJsonPath: string, newVersion: string): void {
    const json = JSON.parse(readFileSync(pkgJsonPath, "utf-8"))
    json.version = newVersion
    delete json.private

    for (const section of ["dependencies", "peerDependencies", "devDependencies"] as const) {
        if (!json[section]) continue
        for (const dep of Object.keys(json[section])) {
            if (dep.startsWith("@grest-ts/")) {
                json[section][dep] = newVersion
            }
        }
    }

    writeFileSync(pkgJsonPath, JSON.stringify(json, null, 2) + "\n")
}

async function main() {
    const args = process.argv.slice(2)
    const dryRun = args.includes("--dry-run")

    // Discover packages from dist/ (verdaccio publishes all, including private)
    const packages = discoverBuiltPackages(false)
    const names = [...packages.keys()].sort()

    // Validate no package depends on a @grest-ts/* package outside the set
    validateDependencies(packages)

    // Strip any previous -verdaccio.N suffix in case dist/ was already stamped
    const rawVersion = packages.values().next().value!.pkg.version
    const baseVersion = rawVersion.replace(/-verdaccio\.\d+$/, "")

    // Query Verdaccio for the next prerelease number
    const prereleaseNum = await getNextPrereleaseNumber(names[0], baseVersion)
    const publishVersion = `${baseVersion}-verdaccio.${prereleaseNum}`

    console.log(`Base version: ${baseVersion}`)
    console.log(`Publish version: ${publishVersion}\n`)

    for (const name of names) {
        console.log(`  ${name}@${publishVersion}`)
    }
    console.log(`\n${names.length} packages to publish\n`)

    if (dryRun) {
        console.log(`Dry run. Use without --dry-run to publish.`)
        return
    }

    // Save original dist/ package.json contents so we can restore after publish
    const originalPackageJsons = new Map<string, string>()
    for (const [, entry] of packages) {
        const pkgPath = join(entry.dir, "package.json")
        originalPackageJsons.set(pkgPath, readFileSync(pkgPath, "utf-8"))
    }

    // Stamp prerelease version on dist/ package.json files (these are copies, not originals)
    for (const [, entry] of packages) {
        updatePackageVersion(join(entry.dir, "package.json"), publishVersion)
    }

    const result = await publishParallel(
        names, packages,
        entry => `npm publish --registry ${REGISTRY} --tag verdaccio`,
        publishVersion
    )

    // Restore original dist/ package.json files
    for (const [pkgPath, content] of originalPackageJsons) {
        writeFileSync(pkgPath, content)
    }
    console.log(`dist/ package.json files restored to v${baseVersion}`)

    if (result.failed.length > 0) {
        process.exit(1)
    }
}

main()
