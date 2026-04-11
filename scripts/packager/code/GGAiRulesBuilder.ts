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
 * Generates AI assistant rule files from source markdown files.
 *
 * Sources:
 *   scripts/ai-rules/grest-ts.md          — full framework reference
 *   scripts/ai-rules/project-context.md   — project-layout stub for the starter template
 *   scripts/ai-rules/checklist-context.md — project-layout stub for the checklist example
 *
 * Repo root outputs (full framework reference — for framework contributors):
 *   CLAUDE.md
 *   AGENTS.md
 *   .cursor/rules/grest-ts.mdc
 *
 * Starter template output (single source — fanned out by create-starter CLI at scaffold time):
 *   packages-tooling/create-starter/template/project-context.md
 *
 * Checklist example outputs (project-layout stub — for developers working in the example):
 *   examples/checklist/CLAUDE.md
 *   examples/checklist/AGENTS.md
 *   examples/checklist/.cursor/rules/project.mdc
 */
export class GGAiRulesBuilder {
    constructor(private readonly rootDir: string) {}

    build(): PackagerFile[] {
        const frameworkBody = this.read("scripts/ai-rules/grest-ts.md")
        const projectBody = this.read("scripts/ai-rules/project-context.md")
        const checklistBody = this.read("scripts/ai-rules/checklist-context.md")

        if (!frameworkBody || !projectBody || !checklistBody) return []

        const starterDir = join(this.rootDir, "packages-tooling", "create-starter", "template")
        const checklistDir = join(this.rootDir, "examples", "checklist")

        return [
            // Repo root — full framework reference
            ...this.destinations(this.rootDir, "grest-ts", frameworkBody),
            // Starter template — single source file; create-starter CLI fans it out at scaffold time
            PackagerFile.copy(join(starterDir, "project-context.md"), projectBody),
            // Checklist example — project-layout stub
            ...this.destinations(checklistDir, "project", checklistBody),
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
