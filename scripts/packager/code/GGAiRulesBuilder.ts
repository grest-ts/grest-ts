import {existsSync, readFileSync} from "fs"
import {join} from "path"
import {PackagerFile} from "./PackagerFile"

/**
 * Generates AI assistant rule files from a single source-of-truth markdown.
 *
 * Source: scripts/ai-rules/grest-ts.md
 *
 * Repo root outputs (full framework reference — for framework contributors):
 *   .cursor/rules/grest-ts.mdc   — Cursor IDE (MDC format with frontmatter)
 *   CLAUDE.md                    — Claude Code CLI
 *   AGENTS.md                    — OpenAI Codex / Agents SDK
 *
 * Starter template outputs (minimal project-context stub — for user projects):
 *   packages-tooling/create-starter/template/.cursor/rules/project.mdc
 *   packages-tooling/create-starter/template/CLAUDE.md
 *   packages-tooling/create-starter/template/AGENTS.md
 *
 * The framework already documents itself via package READMEs and source.
 * User projects only need context about their own layout, not a framework tutorial.
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

        const frameworkBody = readFileSync(this.sourceFile, "utf-8")
        const projectStub = this.buildProjectStub()

        const starterDir = join(this.rootDir, "packages-tooling", "create-starter", "template")

        return [
            // Repo root — full framework reference (for framework contributors)
            PackagerFile.copy(join(this.rootDir, ".cursor", "rules", "grest-ts.mdc"), this.buildCursorMdc(frameworkBody)),
            PackagerFile.copy(join(this.rootDir, "CLAUDE.md"), frameworkBody),
            PackagerFile.copy(join(this.rootDir, "AGENTS.md"), frameworkBody),
            // Starter template — minimal project-context stub (for user projects)
            PackagerFile.copy(join(starterDir, ".cursor", "rules", "project.mdc"), this.buildCursorMdc(projectStub)),
            PackagerFile.copy(join(starterDir, "CLAUDE.md"), projectStub),
            PackagerFile.copy(join(starterDir, "AGENTS.md"), projectStub),
        ]
    }

    private buildCursorMdc(body: string): string {
        return `---
description: grest-ts project context
globs: ["**/*.ts", "**/*.tsx"]
alwaysApply: true
---

` + body
    }

    /**
     * Minimal project-context stub for user projects created from the starter.
     * Describes the project layout — not the framework internals.
     * The framework documents itself via package READMEs and source code.
     */
    private buildProjectStub(): string {
        return `# Project context

This is a **grest-ts** project (npm workspaces monorepo).
Framework docs: https://github.com/grest-ts/grest-ts

## Package layout

\`\`\`
api/      — shared API contracts (@newproject/api)
            api/src/api/   ← contract definitions live here
server/   — backend implementation + integration tests
            server/src/AppRuntime.ts   ← runtime entry point (compose() wires everything)
            server/src/services/       ← API implementations
            server/test/integration/   ← integration tests
            server/test/TestContext.ts ← extend GGTestContext here for auth helpers
client/   — frontend
\`\`\`

## Key conventions

- Contracts defined in \`api/\` are imported by both \`server/\` and \`client/\`.
- All service wiring is in \`AppRuntime.compose()\` — no DI, plain constructors.
- Integration tests use \`GGTest.startWorker(AppRuntime)\` + \`GGTestContext.apis()\`.
- Run server: \`cd server && npm run dev\`
- Run tests: \`cd server && npm test\`
`
    }
}
