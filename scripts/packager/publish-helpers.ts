// Shared utilities for the npm publish script.
import {exec} from "child_process"
import {promisify} from "util"
import {readFileSync, readdirSync, existsSync} from "fs"
import {join, resolve} from "path"

export const execAsync = promisify(exec)

export const ROOT = resolve(import.meta.dirname, "..", "..")
export const DIST_ROOT = join(ROOT, "dist")

export interface DistPackageJson {
    name: string
    version: string
    private?: boolean
    publishConfig?: { access: string }
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    devDependencies?: Record<string, string>
}

export interface DistPackageEntry {
    dir: string
    pkg: DistPackageJson
}

/** Discover all built packages from dist/@grest-ts/* */
export function discoverBuiltPackages( isPublic: boolean ): Map<string, DistPackageEntry> {
    const scopeDir = join(DIST_ROOT, "@grest-ts")
    if (!existsSync(scopeDir)) {
        console.error("No dist/@grest-ts/ found. Run `tsx grest.build.ts` first.")
        process.exit(1)
    }

    const packages = new Map<string, DistPackageEntry>()

    for (const entry of readdirSync(scopeDir, {withFileTypes: true})) {
        if (!entry.isDirectory()) continue
        const dir = join(scopeDir, entry.name)
        const pkgPath = join(dir, "package.json")
        if (!existsSync(pkgPath)) continue
        const pkg: DistPackageJson = JSON.parse(readFileSync(pkgPath, "utf-8"))
        if (isPublic) {
            if (pkg.private) continue
            if (pkg.publishConfig?.access !== "public") {
                console.error(`${pkg.name} is not private but missing publishConfig.access: "public". Run 'npm run generate'.`)
                process.exit(1)
            }
        }
        packages.set(pkg.name, {dir, pkg})
    }

    return packages
}

/**
 * Check that no package in the publish set depends on a @grest-ts/* package
 * that isn't also in the publish set.
 */
export function validateDependencies(packages: Map<string, DistPackageEntry>): void {
    const errors: string[] = []

    for (const [name, {pkg}] of packages) {
        for (const section of ["dependencies", "peerDependencies"] as const) {
            const deps = pkg[section]
            if (!deps) continue
            for (const dep of Object.keys(deps)) {
                if (dep.startsWith("@grest-ts/") && !packages.has(dep)) {
                    errors.push(`${name} has ${section} on ${dep}, which is not in the publish set`)
                }
            }
        }
    }

    if (errors.length > 0) {
        console.error("Dependency validation failed:\n")
        for (const err of errors) {
            console.error(`  - ${err}`)
        }
        console.error("\nEither add publishToNpm: true to the missing packages, or remove the dependency.")
        process.exit(1)
    }
}

/**
 * Publish packages in parallel, logging progress and reporting failures.
 * Returns the list of failed package names (empty on full success).
 */
export interface PublishResult {
    published: string[]
    skipped: string[]
    failed: string[]
}

export async function publishParallel(
    names: string[],
    packages: Map<string, DistPackageEntry>,
    publishCmd: (entry: DistPackageEntry) => string,
    version: string
): Promise<PublishResult> {
    console.log(`Publishing ${names.length} packages in parallel...\n`)
    let done = 0

    const results = await Promise.allSettled(
        names.map(async name => {
            const entry = packages.get(name)!
            await execAsync(publishCmd(entry), {cwd: entry.dir, timeout: 120000})
            done++
            console.log(`  [${done}/${names.length}] ${name}@${version}`)
        })
    )

    const published: string[] = []
    const skipped: string[] = []
    const failed: string[] = []
    for (let i = 0; i < results.length; i++) {
        const r = results[i]
        if (r.status === "fulfilled") {
            published.push(names[i])
        } else {
            const err = r.reason
            const stderr = err?.stderr?.toString?.() ?? err?.message ?? err
            if (/previously published version|Cannot publish over/i.test(String(stderr))) {
                done++
                console.log(`  [${done}/${names.length}] ${names[i]}@${version} (already published, skipped)`)
                skipped.push(names[i])
            } else {
                console.error(`  FAILED ${names[i]}: ${stderr}`)
                failed.push(names[i])
            }
        }
    }

    console.log(`\n--------------------------------------------`)
    console.log(`Published: ${published.length}, Skipped (up to date): ${skipped.length}, Failed: ${failed.length} (version ${version})`)

    return {published, skipped, failed}
}
