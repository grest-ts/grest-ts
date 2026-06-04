import { readFile, writeFile } from "fs/promises"
import { dirname, join } from "path"
import type { GGPackageInfo } from "./GGParser"

/**
 * Automatically detects and fixes invalid import patterns in source files.
 *
 * Fixes two types of issues:
 *
 * 1. Deep @grest-ts imports: `@grest-ts/pkg/src/File` → `@grest-ts/pkg`
 *    When someone imports from internal paths of another package instead of
 *    the public API. These are simplified to the package root.
 *
 * 2. Cross-package relative imports: `../../other-pkg/src/File` → removed
 *    When a file (typically index.ts) re-exports from another package's source
 *    directory using relative paths. These lines are deleted entirely since
 *    they create circular build dependencies.
 */
export interface ImportFix {
    file: string
    line: number
    original: string
    fixed: string | null
    reason: string
}

export class GGImportFixer {
    private readonly packages: GGPackageInfo[]
    constructor(
        packages: GGPackageInfo[]
    ) {
        this.packages = packages
    }

    async fix(): Promise<ImportFix[]> {
        const allFixes: ImportFix[] = []

        for (const pkg of this.packages) {
            const fixes = await this.fixPackage(pkg)
            allFixes.push(...fixes)
        }

        return allFixes
    }

    private async fixPackage(pkg: GGPackageInfo): Promise<ImportFix[]> {
        const fixes: ImportFix[] = []

        for (const file of pkg.sourceFiles) {
            const fileFixes = await this.fixFile(file, pkg)
            fixes.push(...fileFixes)
        }

        return fixes
    }

    private async fixFile(filePath: string, pkg: GGPackageInfo): Promise<ImportFix[]> {
        const content = await readFile(filePath, "utf-8")
        const lines = content.split("\n")
        const fixes: ImportFix[] = []
        let modified = false
        const newLines: string[] = []

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            const fix = this.checkLine(line, i + 1, filePath, pkg)

            if (fix) {
                fixes.push(fix)
                if (fix.fixed === null) {
                    modified = true
                    continue
                } else if (fix.fixed !== fix.original) {
                    newLines.push(line.replace(fix.original, fix.fixed))
                    modified = true
                    continue
                }
            }
            newLines.push(line)
        }

        if (modified) {
            await writeFile(filePath, newLines.join("\n"))
        }

        return fixes
    }

    private checkLine(line: string, lineNum: number, filePath: string, pkg: GGPackageInfo): ImportFix | null {
        const importMatch = line.match(/^(import|export)\s+.*?from\s+["']([^"']+)["']/)
        if (!importMatch) return null

        const importPath = importMatch[2]

        const deepGgImportFix = this.checkDeepGgImport(importPath, lineNum, filePath)
        if (deepGgImportFix) return deepGgImportFix

        const crossPackageFix = this.checkCrossPackageImport(importPath, lineNum, filePath, pkg)
        if (crossPackageFix) return crossPackageFix

        return null
    }

    private checkDeepGgImport(importPath: string, lineNum: number, filePath: string): ImportFix | null {
        const match = importPath.match(/^(@grest-ts\/[^/]+)\/src\/.*$/)
        if (!match) return null

        const basePkg = match[1]
        return {
            file: filePath,
            line: lineNum,
            original: importPath,
            fixed: basePkg,
            reason: `Deep import into ${basePkg}/src/ simplified to ${basePkg}`
        }
    }

    private checkCrossPackageImport(
        importPath: string,
        lineNum: number,
        filePath: string,
        currentPkg: GGPackageInfo
    ): ImportFix | null {
        if (!importPath.startsWith("..")) return null

        const fileDir = dirname(filePath)
        const resolvedPath = join(fileDir, importPath).replace(/\\/g, "/")

        const currentPkgSrc = join(currentPkg.path, "src").replace(/\\/g, "/")
        if (resolvedPath.startsWith(currentPkgSrc)) return null

        for (const otherPkg of this.packages) {
            if (otherPkg.shortName === currentPkg.shortName) continue

            const otherPkgSrc = join(otherPkg.path, "src").replace(/\\/g, "/")
            if (resolvedPath.startsWith(otherPkgSrc)) {
                return {
                    file: filePath,
                    line: lineNum,
                    original: importPath,
                    fixed: null,
                    reason: `Cross-package import from ${currentPkg.shortName} to ${otherPkg.shortName}/src - line removed`
                }
            }
        }

        return null
    }
}
