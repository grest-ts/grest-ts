// Builds all @grest-ts/* packages to the root dist/ staging area.
// Each package is compiled with tsc (parallel), then assembled into dist/@grest-ts/<name>/
// mirroring the exact structure that gets published to npm.
//
// The dist/ folder is NOT cleaned up after — inspect it freely.
// Usage: tsx grest.build.ts
import {exec} from "child_process"
import {promisify} from "util"
import {readFileSync, readdirSync, existsSync, rmSync, cpSync, mkdirSync, writeFileSync, statSync} from "fs"
import {join, resolve} from "path"
import {generateTestkitExtensions} from "#scripts/packager/generate-testkit-extensions"

const execAsync = promisify(exec)

const ROOT = resolve(import.meta.dirname)
const DIST_ROOT = join(ROOT, "dist")

interface PackageJson {
    name: string
    version: string
    private?: boolean
    exports?: Record<string, any>
    files?: string[]
}

function readPkg(dir: string): PackageJson | null {
    const path = join(dir, "package.json")
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, "utf-8"))
}

interface DiscoveredPackage {
    dir: string
    pkg: PackageJson
    /** If true, this package has no TypeScript source — just copy files to dist */
    noSourceCode?: true
}

/** Resolve workspace patterns from root package.json into all buildable packages */
function discoverPackages(): Map<string, DiscoveredPackage> {
    const rootPkg = readPkg(ROOT)
    if (!rootPkg) throw new Error("No root package.json")
    const workspaces: string[] = (rootPkg as any).workspaces ?? []

    const packages = new Map<string, DiscoveredPackage>()

    function checkDir(dir: string): void {
        const pkg = readPkg(dir)
        if (!pkg) return

        // Standard @grest-ts/* packages with tsconfig.publish.json
        if (pkg.name.startsWith("@grest-ts/") && existsSync(join(dir, "tsconfig.publish.json"))) {
            packages.set(pkg.name, {dir, pkg})
            return
        }

        // noSourceCode packages: have grest.package.ts with noSourceCode
        const grestPkgPath = join(dir, "grest.package.ts")
        if (pkg.name && existsSync(grestPkgPath)) {
            const content = readFileSync(grestPkgPath, "utf-8")
            if (/noSourceCode\s*:/.test(content)) {
                packages.set(pkg.name, {dir, pkg, noSourceCode: true})
            }
        }
    }

    for (const pattern of workspaces) {
        if (pattern.endsWith("/*")) {
            const baseDir = join(ROOT, pattern.slice(0, -2))
            if (!existsSync(baseDir)) continue
            for (const entry of readdirSync(baseDir, {withFileTypes: true})) {
                if (!entry.isDirectory() || entry.name === "node_modules") continue
                checkDir(join(baseDir, entry.name))
            }
        } else {
            checkDir(join(ROOT, pattern))
        }
    }

    return packages
}

/** Rewrite a .ts (or .d.ts) source path to its dist/ compiled equivalent.
 *  `.d.ts` inputs are declaration-only and shouldn't have their extension swapped. */
function toDistPath(tsPath: string, ext: ".js" | ".d.ts"): string {
    const distPath = tsPath.replace(/^\.\//, "./dist/")
    if (distPath.endsWith(".d.ts")) return distPath
    return distPath.replace(/\.ts$/, ext)
}

/** Rewrite a single export entry (types + import) to point to dist/ */
function rewriteExportEntry(entry: {types: string; import: string}): {types: string; import: string} {
    return {
        types: toDistPath(entry.types, ".d.ts"),
        import: toDistPath(entry.import, ".js")
    }
}

/**
 * Rewrite package.json exports to point to dist/ compiled output.
 * Handles both flat exports ({types, import}) and conditional exports ({browser, default}).
 */
function rewriteExports(exports: Record<string, any>): Record<string, any> {
    const rewritten: Record<string, any> = {}

    for (const [key, value] of Object.entries(exports)) {
        if (value.types && value.import) {
            rewritten[key] = rewriteExportEntry(value)
        } else {
            const conditional: Record<string, any> = {}
            for (const [condition, entry] of Object.entries(value)) {
                if (entry && typeof entry === "object" && "types" in entry && "import" in entry) {
                    conditional[condition] = rewriteExportEntry(entry as any)
                } else {
                    conditional[condition] = entry
                }
            }
            rewritten[key] = conditional
        }
    }

    return rewritten
}

/** Clean a directory */
function cleanDir(dir: string): void {
    if (existsSync(dir)) {
        rmSync(dir, {recursive: true, force: true})
    }
}

/**
 * Fix relative imports/exports in compiled .js files to include .js extensions.
 * Required because tsc with moduleResolution "Bundler" doesn't add them,
 * but Node ESM ("type": "module") requires explicit extensions.
 */
function fixImportExtensions(dir: string): void {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
            fixImportExtensions(fullPath)
            continue
        }
        if (!entry.name.endsWith(".js")) continue

        const content = readFileSync(fullPath, "utf-8")
        // Match any string literal containing a relative path in from clauses or bare imports:
        //   from "./foo"  |  from "../foo/bar"  |  import "./foo"
        const fixed = content.replace(
            /(?<=from\s+|import\s+)(["'])(\.\.?\/[^"']+)\1/g,
            (_match, quote, specifier) => {
                // Already has a JS/JSON file extension
                if (/\.(js|mjs|cjs|json)$/.test(specifier)) return `${quote}${specifier}${quote}`
                // Check if it's a directory (index import)
                const asDir = join(dir, specifier)
                if (existsSync(asDir) && statSync(asDir).isDirectory()) {
                    return `${quote}${specifier}/index.js${quote}`
                }
                return `${quote}${specifier}.js${quote}`
            }
        )
        if (fixed !== content) {
            writeFileSync(fullPath, fixed)
        }
    }
}

/** Copy non-compiled assets (.mjs, .cjs, hand-authored .d.ts, …) from src to
 *  dist, preserving directory structure. Skips .ts source files (tsc already
 *  emitted compiled equivalents) but DOES copy .d.ts inputs (tsc reads them
 *  as declarations but doesn't emit them). */
function copyNonTsAssets(srcDir: string, distDir: string): void {
    if (!existsSync(srcDir)) return
    for (const entry of readdirSync(srcDir, {withFileTypes: true})) {
        const srcPath = join(srcDir, entry.name)
        const distPath = join(distDir, entry.name)
        if (entry.isDirectory()) {
            copyNonTsAssets(srcPath, distPath)
            continue
        }
        const isCompiledSource = entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")
        if (isCompiledSource) continue
        if (existsSync(distDir)) {
            cpSync(srcPath, distPath)
        }
    }
}

/** Build a package by running tsc with tsconfig.publish.json (async for parallel execution) */
async function buildPackage(name: string, dir: string): Promise<void> {
    const tsconfigPath = join(dir, "tsconfig.publish.json")
    if (!existsSync(tsconfigPath)) {
        throw new Error(`${name}: missing tsconfig.publish.json — run 'npm run generate' first`)
    }

    cleanDir(join(dir, "dist"))
    // --noCheck: type-checking is already done separately (grest.check.ts).
    // Without --noCheck, tsc follows workspace imports into upstream .ts source files and
    // may hit type errors from declaration-merging that only resolve in the root compilation.
    await execAsync(`npx tsc -p tsconfig.publish.json --noCheck`, {
        cwd: dir,
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024
    })

    // Fix relative imports to include .js extensions (required for Node ESM)
    fixImportExtensions(join(dir, "dist"))

    // Copy non-ts assets (.mjs, .cjs, etc.) from src/ into dist/src/ since tsc only emits .ts files
    copyNonTsAssets(join(dir, "src"), join(dir, "dist", "src"))
}

/**
 * Assemble a package's staging directory under root dist/.
 * Copies compiled output + source files, writes rewritten package.json.
 *
 * Structure: dist/@grest-ts/<name>/
 *   dist/src/index-node.js, .d.ts, .d.ts.map   (compiled)
 *   src/index-node.ts                           (original source, for declarationMap)
 *   package.json                                (rewritten exports → dist/)
 */
function assembleStaging(name: string, dir: string): void {
    const stagingDir = join(DIST_ROOT, name)
    mkdirSync(stagingDir, {recursive: true})

    const pkgJson = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"))

    // Copy compiled dist/ folder
    cpSync(join(dir, "dist"), join(stagingDir, "dist"), {recursive: true})

    // Copy source folders listed in files array (src/, codegen/, bin/)
    // Skip directories that match export subpaths (e.g. "testkit") — the compiled
    // version in dist/ handles those, and raw .ts source dirs would shadow the
    // exports map and cause Node ESM to resolve to .ts files instead.
    const exportSubpaths = new Set(
        Object.keys(pkgJson.exports ?? {}).map((k: string) => k.replace(/^\.\//, ""))
    )
    for (const entry of pkgJson.files ?? []) {
        if (exportSubpaths.has(entry)) continue
        const srcPath = join(dir, entry)
        if (existsSync(srcPath)) {
            cpSync(srcPath, join(stagingDir, entry), {recursive: true})
        }
    }

    // Copy LICENSE if it exists
    const licensePath = join(dir, "LICENSE")
    if (existsSync(licensePath)) {
        cpSync(licensePath, join(stagingDir, "LICENSE"))
    }

    // Copy README*.md files (README.md, README-extending.md, etc.)
    for (const entry of readdirSync(dir)) {
        if (/^README.*\.md$/i.test(entry)) {
            cpSync(join(dir, entry), join(stagingDir, entry))
        }
    }

    // Write rewritten package.json (exports → dist/, files includes dist/)
    if (pkgJson.exports) {
        pkgJson.exports = rewriteExports(pkgJson.exports)
    }
    if (pkgJson.files) {
        pkgJson.files = ["dist", ...pkgJson.files.filter((f: string) => !exportSubpaths.has(f))]
    }
    delete pkgJson["//"]
    writeFileSync(join(stagingDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n")

    // Clean per-package dist/ (output now lives in root dist/ staging area)
    cleanDir(join(dir, "dist"))
}

/**
 * Stage a noSourceCode package: copy files + package.json + LICENSE to dist/<name>/.
 * No compilation or export rewriting.
 */
function assembleNoSourceCodeStaging(name: string, dir: string): void {
    const stagingDir = join(DIST_ROOT, name)
    mkdirSync(stagingDir, {recursive: true})

    const pkgJson = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"))

    for (const entry of pkgJson.files ?? []) {
        const srcPath = join(dir, entry)
        if (existsSync(srcPath)) {
            cpSync(srcPath, join(stagingDir, entry), {recursive: true})
        }
    }

    cpSync(join(dir, "package.json"), join(stagingDir, "package.json"))

    const licensePath = join(dir, "LICENSE")
    if (existsSync(licensePath)) {
        cpSync(licensePath, join(stagingDir, "LICENSE"))
    }

    for (const entry of readdirSync(dir)) {
        if (/^README.*\.md$/i.test(entry)) {
            cpSync(join(dir, entry), join(stagingDir, entry))
        }
    }
}

async function main() {
    // Refresh testkit-vitest/src/extensions.d.ts so tsc picks up the current
    // set of plugin testkit references when compiling testkit-vitest below.
    generateTestkitExtensions()

    const packages = discoverPackages()
    const names = [...packages.keys()].sort()
    const compiledNames = names.filter(n => !packages.get(n)!.noSourceCode)
    const noSourceCodeNames = names.filter(n => packages.get(n)!.noSourceCode)

    const rootPkg = readPkg(ROOT)
    console.log(`Version: ${rootPkg!.version}`)
    console.log(`Found ${names.length} packages (${compiledNames.length} compiled, ${noSourceCodeNames.length} noSourceCode)\n`)

    // Clean root dist/
    cleanDir(DIST_ROOT)

    // Build compiled packages in parallel
    console.log("Building packages (parallel)...\n")

    const buildResults: PromiseSettledResult<void>[] = []
    const LIMIT = 4
    for (let i = 0; i < compiledNames.length; i += LIMIT) {
        const batch = compiledNames.slice(i, i + LIMIT)
        const batchResults = await Promise.allSettled(
            batch.map(async name => {
                const entry = packages.get(name)!
                await buildPackage(name, entry.dir)
                console.log(`  built ${name}`)
            })
        )
        buildResults.push(...batchResults)
    }

    const buildFailures = buildResults.filter(r => r.status === "rejected")
    if (buildFailures.length > 0) {
        for (const f of buildFailures) {
            const err = (f as PromiseRejectedResult).reason
            const stderr = err?.stderr?.toString?.() ?? err?.message ?? err
            console.error(`  BUILD FAILED: ${stderr}`)
        }
        for (const name of compiledNames) {
            cleanDir(join(packages.get(name)!.dir, "dist"))
        }
        process.exit(1)
    }

    console.log(`\nAll ${compiledNames.length} compiled packages built successfully.`)

    // Assemble root dist/ staging area
    console.log("\nAssembling dist/...\n")

    for (const name of compiledNames) {
        const entry = packages.get(name)!
        assembleStaging(name, entry.dir)
        console.log(`  staged ${name}`)
    }

    for (const name of noSourceCodeNames) {
        const entry = packages.get(name)!
        assembleNoSourceCodeStaging(name, entry.dir)
        console.log(`  staged ${name} (noSourceCode)`)
    }

    console.log(`\nDone — dist/ contains ${names.length} packages.`)
}

main()
