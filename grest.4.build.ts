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

/** Resolve workspace patterns from root package.json into all @grest-ts/* packages that have tsconfig.publish.json */
function discoverPackages(): Map<string, { dir: string; pkg: PackageJson }> {
    const rootPkg = readPkg(ROOT)
    if (!rootPkg) throw new Error("No root package.json")
    const workspaces: string[] = (rootPkg as any).workspaces ?? []

    const packages = new Map<string, { dir: string; pkg: PackageJson }>()

    for (const pattern of workspaces) {
        if (pattern.endsWith("/*")) {
            const baseDir = join(ROOT, pattern.slice(0, -2))
            if (!existsSync(baseDir)) continue
            for (const entry of readdirSync(baseDir, {withFileTypes: true})) {
                if (!entry.isDirectory() || entry.name === "node_modules") continue
                const dir = join(baseDir, entry.name)
                const pkg = readPkg(dir)
                if (pkg && pkg.name.startsWith("@grest-ts/") && existsSync(join(dir, "tsconfig.publish.json"))) {
                    packages.set(pkg.name, {dir, pkg})
                }
            }
        } else {
            const dir = join(ROOT, pattern)
            const pkg = readPkg(dir)
            if (pkg && pkg.name.startsWith("@grest-ts/") && existsSync(join(dir, "tsconfig.publish.json"))) {
                packages.set(pkg.name, {dir, pkg})
            }
        }
    }

    return packages
}

/** Rewrite a .ts source path to its dist/ compiled equivalent */
function toDistPath(tsPath: string, ext: ".js" | ".d.ts"): string {
    return tsPath.replace(/^\.\//, "./dist/").replace(/\.ts$/, ext)
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

/** Copy non-TypeScript assets (.mjs, .cjs, etc.) from src to dist, preserving directory structure */
function copyNonTsAssets(srcDir: string, distDir: string): void {
    if (!existsSync(srcDir)) return
    for (const entry of readdirSync(srcDir, {withFileTypes: true})) {
        const srcPath = join(srcDir, entry.name)
        const distPath = join(distDir, entry.name)
        if (entry.isDirectory()) {
            copyNonTsAssets(srcPath, distPath)
        } else if (!entry.name.endsWith(".ts")) {
            if (existsSync(distDir)) {
                cpSync(srcPath, distPath)
            }
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

async function main() {
    const packages = discoverPackages()
    const names = [...packages.keys()].sort()

    const rootPkg = readPkg(ROOT)
    console.log(`Version: ${rootPkg!.version}`)
    console.log(`Found ${names.length} packages\n`)

    // Clean root dist/
    cleanDir(DIST_ROOT)

    // Build all packages in parallel
    console.log("Building packages (parallel)...\n")

    const buildResults = await Promise.allSettled(
        names.map(async name => {
            const entry = packages.get(name)!
            await buildPackage(name, entry.dir)
            console.log(`  built ${name}`)
        })
    )

    const buildFailures = buildResults.filter(r => r.status === "rejected")
    if (buildFailures.length > 0) {
        for (const f of buildFailures) {
            const err = (f as PromiseRejectedResult).reason
            const stderr = err?.stderr?.toString?.() ?? err?.message ?? err
            console.error(`  BUILD FAILED: ${stderr}`)
        }
        for (const name of names) {
            cleanDir(join(packages.get(name)!.dir, "dist"))
        }
        process.exit(1)
    }

    console.log(`\nAll ${names.length} packages built successfully.`)

    // Assemble root dist/ staging area
    console.log("\nAssembling dist/...\n")

    for (const name of names) {
        const entry = packages.get(name)!
        assembleStaging(name, entry.dir)
        console.log(`  staged ${name}`)
    }

    console.log(`\nDone — dist/ contains ${names.length} packages.`)
}

main()
