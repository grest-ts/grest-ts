// Publishes public packages from the dist/ staging area to the npm registry.
// Only publishes packages that have publishToNpm (i.e. not marked private).
// Skips packages whose version is already published.
// Requires `npm login` beforehand (or NPM_TOKEN env var).
//
// Usage: tsx grest.5.npm.publish.ts [--dry-run]
import {execSync} from "child_process"
import {createInterface} from "readline"
import {discoverBuiltPackages, validateDependencies, publishParallel, execAsync} from "./grest.lib.publish"

/** Verify npm auth is configured */
function ensureNpmAuth(): void {
    try {
        const whoami = execSync("npm whoami", {stdio: "pipe", timeout: 10000}).toString().trim()
        console.log(`Logged in to npm as: ${whoami}`)
    } catch {
        console.error("Not logged in to npm. Run `npm login` first or set NPM_TOKEN.")
        process.exit(1)
    }
}

/** Check which packages are already published (parallel) */
async function filterAlreadyPublished(names: string[], version: string): Promise<{toPublish: string[], skipped: string[]}> {
    const results = await Promise.allSettled(
        names.map(async name => {
            const {stdout} = await execAsync(`npm view ${name}@${version} version`, {timeout: 10000})
            return stdout.trim() === version
        })
    )

    const toPublish: string[] = []
    const skipped: string[] = []
    for (let i = 0; i < names.length; i++) {
        const r = results[i]
        const alreadyPublished = r.status === "fulfilled" && r.value
        if (alreadyPublished) {
            skipped.push(names[i])
        } else {
            toPublish.push(names[i])
        }
    }
    return {toPublish, skipped}
}

/** Prompt user for confirmation. Returns true if they type 'yes'. */
async function confirm(message: string): Promise<boolean> {
    const rl = createInterface({input: process.stdin, output: process.stdout})
    return new Promise(resolve => {
        rl.question(`${message} (yes/no): `, answer => {
            rl.close()
            resolve(answer.trim().toLowerCase() === "yes")
        })
    })
}

async function main() {
    const args = process.argv.slice(2)
    const dryRun = args.includes("--dry-run")

    // Discover publishable (non-private) packages from dist/
    const packages = discoverBuiltPackages(true)
    const names = [...packages.keys()].sort()
    const version = packages.values().next().value!.pkg.version

    console.log(`Version: ${version}`)
    console.log(`Found ${packages.size} publishable packages in dist/\n`)

    // Validate no publishable package depends on a non-published @grest-ts/* package
    validateDependencies(packages)

    // Check which packages are already published
    const {toPublish, skipped} = await filterAlreadyPublished(names, version)

    for (const name of skipped) {
        console.log(`  skip ${name}@${version} (already published)`)
    }
    for (const name of toPublish) {
        console.log(`  publish ${name}@${version}`)
    }

    if (toPublish.length === 0) {
        console.log("\nAll packages are already published at this version.")
        return
    }

    console.log(`\n${toPublish.length} package(s) to publish`)

    if (dryRun) {
        console.log("\nDry run. Use without --dry-run to publish.")
        return
    }

    // Verify npm auth (after all local checks pass)
    ensureNpmAuth()

    // Confirm before publishing
    console.log("\n--------------------------------------------")
    console.log(`About to publish ${toPublish.length} package(s) to the PUBLIC npm registry as v${version}.\n`)

    const confirmed = await confirm("Proceed with publish?")
    if (!confirmed) {
        console.log("\nAborted.")
        return
    }

    const result = await publishParallel(
        toPublish, packages,
        () => `npm publish --access public`,
        version
    )

    if (result.failed.length > 0) {
        process.exit(1)
    }
}

main()
