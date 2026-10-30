import { existsSync, readFileSync } from "fs"
import { builtinModules } from "module"
import { dirname, join, relative, resolve } from "path"
import type { GGPackageInfo } from "./GGParser"

const BUILTINS = new Set(builtinModules)
// Type-only imports are erased, so they don't reach a bundle.
const IMPORT = /^[ \t]*(?:import|export)(?![ \t]+type[ \t{*])[ \t]*(?:[\w$*{}\s,]+?\s+from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/gm

/**
 * Validates that a browser entry can't reach Node-only code: walks the relative imports from the entry and fails on
 * Node built-ins, `*.node.ts` modules, and @grest-ts/* packages that have no browser target.
 */
export class GGBrowserEntryChecker {
    private readonly packages: GGPackageInfo[]
    constructor(packages: GGPackageInfo[]) {
        this.packages = packages
    }

    check(): void {
        const browserPackages = new Set(this.packages.filter(p => p.config.targets.browser).map(p => p.name))
        const violations: string[] = []

        for (const pkg of this.packages) {
            if (!pkg.config.targets.browser) continue
            const entry = join(pkg.path, "src", pkg.entryMode === "library" ? "index.ts" : "index-browser.ts")
            if (!existsSync(entry)) continue
            const seen = new Set<string>()
            const visit = (file: string): void => {
                if (seen.has(file)) return
                seen.add(file)
                const at = relative(pkg.path, file)
                for (const match of readFileSync(file, "utf-8").matchAll(IMPORT)) {
                    const spec = (match[1] ?? match[2])!
                    if (spec.startsWith(".")) {
                        const target = resolveSource(dirname(file), spec)
                        if (!target) continue
                        if (/\.node\.tsx?$/.test(target)) violations.push(`${pkg.name}: ${at} imports ${spec}, a Node-only module`)
                        visit(target)
                    } else if (spec.startsWith("node:") || BUILTINS.has(spec.split("/")[0]!)) {
                        violations.push(`${pkg.name}: ${at} imports the Node built-in ${spec}`)
                    } else if (spec.startsWith("@grest-ts/")) {
                        const name = spec.split("/").slice(0, 2).join("/")
                        if (!browserPackages.has(name)) violations.push(`${pkg.name}: ${at} imports ${spec}, which has no browser target`)
                    }
                }
            }
            visit(entry)
        }

        if (violations.length > 0) {
            throw new Error(
                `Browser entries reach Node-only code:\n\n  ${violations.join("\n  ")}\n\n` +
                `Move that code behind the node entry (index-node.ts).`
            )
        }
    }
}

function resolveSource(dir: string, spec: string): string | undefined {
    const base = resolve(dir, spec.replace(/\.js$/, ""))
    return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find(f => /\.tsx?$/.test(f) && existsSync(f))
}
