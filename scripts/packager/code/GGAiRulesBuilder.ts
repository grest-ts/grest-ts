import {existsSync, readFileSync} from "fs"
import {join} from "path"
import {PackagerFile} from "./PackagerFile"

const MDC_FRONTMATTER = `---
description: grest-ts project context
globs: ["**/*.ts", "**/*.tsx"]
alwaysApply: true
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
 * Starter template output (single source — fanned out by create-starter CLI at scaffold time):
 *   packages-tooling/create-starter/template/project-context.md
 *
 * The create-starter CLI (index.mjs) copies project-context.md to CLAUDE.md, AGENTS.md,
 * and .cursor/rules/project.mdc in the new project at scaffold time, then removes the source file.
 * This way only one file lives in the template, not three identical copies.
 */
export class GGAiRulesBuilder {
    constructor(private readonly rootDir: string) {}

    build(): PackagerFile[] {
        const frameworkBody = this.read("scripts/ai-rules/grest-ts.md")
        const projectBody = this.read("scripts/ai-rules/project-context.md")

        if (!frameworkBody || !projectBody) return []

        const starterDir = join(this.rootDir, "packages-tooling", "create-starter", "template")

        return [
            // Repo root — full framework reference
            ...this.destinations(this.rootDir, "grest-ts", frameworkBody),
            // Starter template — single source file; create-starter CLI fans it out at scaffold time
            PackagerFile.copy(join(starterDir, "project-context.md"), projectBody),
        ]
    }

    /** Emit CLAUDE.md, AGENTS.md, and .cursor/rules/<name>.mdc for a given directory and body. */
    private destinations(dir: string, mdcName: string, body: string): PackagerFile[] {
        return [
            PackagerFile.copy(join(dir, "CLAUDE.md"), body),
            PackagerFile.copy(join(dir, "AGENTS.md"), body),
            PackagerFile.copy(join(dir, ".cursor", "rules", `${mdcName}.mdc`), MDC_FRONTMATTER + body),
        ]
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
