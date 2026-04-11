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
 * Each source is copied to all its destinations. The .mdc (Cursor) variants
 * get MDC frontmatter prepended; everything else is a plain copy.
 *
 * Repo root (full framework reference — for framework contributors):
 *   CLAUDE.md
 *   AGENTS.md
 *   .cursor/rules/grest-ts.mdc
 *
 * Starter template (project-layout stub — inherited by new user projects):
 *   packages-tooling/create-starter/template/CLAUDE.md
 *   packages-tooling/create-starter/template/AGENTS.md
 *   packages-tooling/create-starter/template/.cursor/rules/project.mdc
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
            ...this.destinations(join(this.rootDir), "grest-ts", frameworkBody),
            // Starter template — project-layout stub
            ...this.destinations(starterDir, "project", projectBody),
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
