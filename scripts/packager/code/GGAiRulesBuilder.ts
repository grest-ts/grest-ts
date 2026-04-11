import {existsSync, readFileSync} from "fs"
import {join} from "path"
import {PackagerFile} from "./PackagerFile"

/**
 * Generates AI assistant rule files from a single source-of-truth markdown.
 *
 * Source: scripts/ai-rules/grest-ts.md
 *
 * Outputs (repo root):
 *   .cursor/rules/grest-ts.mdc   — Cursor IDE (MDC format with frontmatter)
 *   CLAUDE.md                    — Claude Code CLI
 *   AGENTS.md                    — OpenAI Codex / Agents SDK
 *
 * Outputs (starter template):
 *   packages-tooling/create-starter/template/.cursor/rules/grest-ts.mdc
 *   packages-tooling/create-starter/template/CLAUDE.md
 *   packages-tooling/create-starter/template/AGENTS.md
 */
export class GGAiRulesBuilder {
    private readonly sourceFile: string

    constructor(private readonly rootDir: string) {
        this.sourceFile = join(rootDir, "scripts", "ai-rules", "grest-ts.md")
    }

    build(): PackagerFile[] {
        if (!existsSync(this.sourceFile)) {
            console.warn(`⚠️  AI rules source not found: ${this.sourceFile}`)
            return []
        }

        const body = readFileSync(this.sourceFile, "utf-8")

        const cursorContent = this.buildCursorMdc(body)
        const claudeContent = this.buildClaudeAgents(body)
        const agentsContent = this.buildClaudeAgents(body)   // same format

        const starterDir = join(this.rootDir, "packages-tooling", "create-starter", "template")

        return [
            // Repo root
            PackagerFile.copy(join(this.rootDir, ".cursor", "rules", "grest-ts.mdc"), cursorContent),
            PackagerFile.copy(join(this.rootDir, "CLAUDE.md"), claudeContent),
            PackagerFile.copy(join(this.rootDir, "AGENTS.md"), agentsContent),
            // Starter template (inherited by new projects)
            PackagerFile.copy(join(starterDir, ".cursor", "rules", "grest-ts.mdc"), cursorContent),
            PackagerFile.copy(join(starterDir, "CLAUDE.md"), claudeContent),
            PackagerFile.copy(join(starterDir, "AGENTS.md"), agentsContent),
        ]
    }

    private buildCursorMdc(body: string): string {
        const frontmatter = `---
description: grest-ts framework — contract-first TypeScript service development
globs: ["**/*.ts", "**/*.tsx"]
alwaysApply: true
---

`
        return frontmatter + body
    }

    private buildClaudeAgents(body: string): string {
        return body
    }
}
