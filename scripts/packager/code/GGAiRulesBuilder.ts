import {existsSync, readFileSync, readdirSync, rmSync} from "fs"
import {join} from "path"
import {PackagerFile} from "./PackagerFile"
import type {GGPackageInfo} from "./GGParser"

const MDC_FRONTMATTER = `---
description: grest-ts project context
globs: ["**/*.ts", "**/*.tsx"]
alwaysApply: true
---

`

const SKILL_FRONTMATTER = `---
name: grest-ts
description: Use whenever the user is using or considering grest-ts (contract-first TypeScript framework). Trigger signals: package.json contains @grest-ts/*; mentions of grest-ts, GGContractClass, GGRuntime, GGHttpSchema, GGTest, GGTestContext, mockOf, @mockable, @testable, GGContextKey, GGConfig; user asks to scaffold a grest-ts service, design an API contract, or write integration tests with testkit.
---

`

/**
 * Generates AI assistant rule files from two source markdown files.
 *
 * Sources:
 *   scripts/ai-rules/grest-ts.md        — full framework reference
 *   scripts/ai-rules/project-context.md — minimal project-layout stub for user projects
 *
 * Repo root outputs (full framework reference — for framework contributors):
 *   CLAUDE.md
 *   AGENTS.md
 *   .cursor/rules/grest-ts.mdc
 *
 * Claude Code plugin outputs (everything plugin-related contained in .claude-plugin/):
 *   .claude-plugin/marketplace.json                                                — marketplace manifest, version synced from root package.json
 *   .claude-plugin/grest-ts/skills/grest-ts/SKILL.md                               — framework body + auto-generated package index
 *   .claude-plugin/grest-ts/skills/grest-ts/packages/<shortName>/README*.md        — every published package's README*, copied verbatim
 *
 * Starter template output (single source — fanned out by create-starter CLI at scaffold time):
 *   packages-tooling/create-starter/template/project-context.md
 *
 * The create-starter CLI (index.mjs) copies project-context.md to CLAUDE.md, AGENTS.md,
 * and .cursor/rules/project.mdc in the new project at scaffold time, then removes the source file.
 * This way only one file lives in the template, not three identical copies.
 */
export class GGAiRulesBuilder {
    private readonly rootDir: string
    private readonly packages: GGPackageInfo[]
    constructor(
        rootDir: string,
        packages: GGPackageInfo[],
    ) {
        this.rootDir = rootDir
        this.packages = packages
    }

    build(): PackagerFile[] {
        const frameworkBody = this.read("scripts/ai-rules/grest-ts.md")
        const projectBody = this.read("scripts/ai-rules/project-context.md")

        if (!frameworkBody || !projectBody) return []

        const starterDir = join(this.rootDir, "packages-tooling", "create-starter", "template")
        // Plugin source lives under .claude-plugin/grest-ts/ (referenced by marketplace.json's
        // `source` field) rather than the repo root, keeping plugin artifacts contained.
        const skillDir = join(this.rootDir, ".claude-plugin", "grest-ts", "skills", "grest-ts")

        // Only bundle packages that are user-facing: published to npm and not hidden.
        // Internal packages (framework infra, benchmarks, experimental) are excluded.
        const publishedPackages = this.packages.filter(
            p => p.config.publishToNpm === true && p.config.hidden !== true
        )

        const skillBody = SKILL_FRONTMATTER + frameworkBody + this.buildPackageReferences(publishedPackages)
        const packageReadmes = this.copyPackageReadmes(skillDir, publishedPackages)

        // Prune orphaned package dirs left behind by removed/renamed packages.
        this.pruneSkillBundleOrphans(skillDir, publishedPackages)

        return [
            // Repo root — full framework reference
            ...this.destinations(this.rootDir, "grest-ts", frameworkBody),
            // Starter template — single source file; create-starter CLI fans it out at scaffold time
            PackagerFile.copy(join(starterDir, "project-context.md"), projectBody),
            // Claude Code marketplace manifest — version synced from root package.json
            PackagerFile.copy(
                join(this.rootDir, ".claude-plugin", "marketplace.json"),
                this.buildMarketplaceJson(),
            ),
            // Claude Code skill — framework body + per-package READMEs for deep-dive
            PackagerFile.copy(join(skillDir, "SKILL.md"), skillBody),
            ...packageReadmes,
        ]
    }

    /** Generate marketplace.json with version synced from the root package.json. */
    private buildMarketplaceJson(): string {
        const rootPackageJson = JSON.parse(this.read("package.json") ?? "{}")
        const version = rootPackageJson.version ?? "0.0.0"
        const manifest = {
            name: "grest-ts",
            owner: {
                name: "grest-ts",
                url: "https://github.com/grest-ts",
            },
            description: "Claude Code knowledge plugin for grest-ts — the contract-first TypeScript framework",
            plugins: [
                {
                    name: "grest-ts",
                    source: "./.claude-plugin/grest-ts",
                    description: "Framework conventions, anti-patterns, and per-package reference docs for grest-ts. Activates whenever Claude works in a project that uses @grest-ts/* packages.",
                    version,
                    author: {name: "grest-ts"},
                    homepage: "https://github.com/grest-ts/grest-ts",
                    repository: "https://github.com/grest-ts/grest-ts",
                    category: "framework",
                },
            ],
        }
        return JSON.stringify(manifest, null, 2) + "\n"
    }

    /** Emit CLAUDE.md, AGENTS.md, and .cursor/rules/<name>.mdc for a given directory and body. */
    private destinations(dir: string, mdcName: string, body: string): PackagerFile[] {
        return [
            PackagerFile.copy(join(dir, "CLAUDE.md"), body),
            PackagerFile.copy(join(dir, "AGENTS.md"), body),
            PackagerFile.copy(join(dir, ".cursor", "rules", `${mdcName}.mdc`), MDC_FRONTMATTER + body),
        ]
    }

    /** Copy every README*.md from each package into skills/grest-ts/packages/<shortName>/. */
    private copyPackageReadmes(skillDir: string, packages: GGPackageInfo[]): PackagerFile[] {
        const files: PackagerFile[] = []
        for (const pkg of packages) {
            for (const readme of this.findReadmes(pkg.path)) {
                const content = readFileSync(join(pkg.path, readme), "utf-8")
                files.push(PackagerFile.copy(
                    join(skillDir, "packages", pkg.shortName, readme),
                    content,
                ))
            }
        }
        return files
    }

    private findReadmes(packageDir: string): string[] {
        if (!existsSync(packageDir)) return []
        return readdirSync(packageDir).filter((f: string) => /^README.*\.md$/.test(f)).sort()
    }

    /** Append a "Package reference" index listing every bundled package and its READMEs. */
    private buildPackageReferences(packages: GGPackageInfo[]): string {
        const sorted = [...packages].sort((a, b) => a.shortName.localeCompare(b.shortName))
        const lines: string[] = [
            "",
            "---",
            "",
            "## Package reference deep-dives",
            "",
            "Read these only when you need package-specific detail (exact API, options, advanced patterns). Paths are relative to this skill's directory.",
            "",
        ]
        for (const pkg of sorted) {
            const readmes = this.findReadmes(pkg.path)
            if (readmes.length === 0) continue
            const links = readmes.map(r => `\`packages/${pkg.shortName}/${r}\``).join(", ")
            lines.push(`- **${pkg.name}** — ${links}`)
        }
        lines.push("")
        return lines.join("\n")
    }

    /**
     * Remove orphans under <skillDir>/packages/:
     *   - whole dirs for packages that no longer exist (renamed, deleted, gone unpublished)
     *   - individual README files inside kept packages that no longer exist upstream
     */
    private pruneSkillBundleOrphans(skillDir: string, packages: GGPackageInfo[]): void {
        const packagesDir = join(skillDir, "packages")
        if (!existsSync(packagesDir)) return

        const expected = new Map<string, Set<string>>(
            packages.map(p => [p.shortName, new Set(this.findReadmes(p.path))])
        )

        for (const entry of readdirSync(packagesDir)) {
            const entryPath = join(packagesDir, entry)
            const expectedReadmes = expected.get(entry)

            if (!expectedReadmes) {
                rmSync(entryPath, {recursive: true, force: true})
                console.log(`   🗑️  Pruned orphaned skill package: ${entry}`)
                continue
            }

            for (const file of readdirSync(entryPath)) {
                if (!expectedReadmes.has(file)) {
                    rmSync(join(entryPath, file), {force: true})
                    console.log(`   🗑️  Pruned orphaned README: ${entry}/${file}`)
                }
            }
        }
    }

    private read(relativePath: string): string | null {
        const fullPath = join(this.rootDir, relativePath)
        if (!existsSync(fullPath)) {
            console.warn(`⚠️  AI rules source not found: ${fullPath}`)
            return null
        }
        return readFileSync(fullPath, "utf-8")
    }
}
