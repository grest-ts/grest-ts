#!/usr/bin/env node
// Deterministic grest-ts convention checker. Zero dependencies (node builtins only).
// Usage: node grest-conventions-check.mjs [--json] <file.ts> [<file.ts> ...]
// Emits high-confidence, mechanically-detectable violations. Judgment-level
// conventions (is this really contract-first? should this live in compose()?) are
// left to the LLM pass in the /grest-review command — this script only flags what
// regex can decide without false positives.

import {readFileSync} from "node:fs"

const args = process.argv.slice(2)
const asJson = args.includes("--json")
const files = args.filter(a => a !== "--json")

const lineAt = (content, index) => content.slice(0, index).split("\n").length

// Each rule: id, severity (error|warning), title, and a (content, file) => findings fn.
// `convention` is the SKILL.md section the rule enforces, surfaced in the report.
const RULES = [
    {
        id: "GR001",
        severity: "error",
        convention: "§6 / §11 — `mockable`/`testable` live in @grest-ts/testkit-runtime",
        scan(content) {
            const out = []
            const re = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']@grest-ts\/testkit["']/g
            let m
            while ((m = re.exec(content))) {
                for (const sym of ["mockable", "testable"]) {
                    if (new RegExp(`\\b${sym}\\b`).test(m[1])) {
                        out.push({line: lineAt(content, m.index), message: `\`${sym}\` imported from @grest-ts/testkit — it lives in @grest-ts/testkit-runtime`})
                    }
                }
            }
            return out
        },
    },
    {
        id: "GR002",
        severity: "error",
        convention: "§6 / §11 — `mockOf`/`spyOn`/`callOn`/`GGTest` live in @grest-ts/testkit",
        scan(content) {
            const out = []
            const re = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']@grest-ts\/testkit-runtime["']/g
            let m
            while ((m = re.exec(content))) {
                for (const sym of ["mockOf", "spyOn", "callOn", "GGTest", "GGTestContext"]) {
                    if (new RegExp(`\\b${sym}\\b`).test(m[1])) {
                        out.push({line: lineAt(content, m.index), message: `\`${sym}\` imported from @grest-ts/testkit-runtime — it lives in @grest-ts/testkit`})
                    }
                }
            }
            return out
        },
    },
    {
        id: "GR003",
        severity: "error",
        convention: "§6 — mocks are per-request via mockOf/spyOn, never global",
        lineRe: /\b(?:jest|vi|vitest)\s*\.\s*mock\s*\(/,
        message: "Global module mock — use `mockOf`/`spyOn` from @grest-ts/testkit instead (per-request, AsyncLocalStorage-scoped)",
    },
    {
        id: "GR004",
        severity: "error",
        convention: "§11 — no Express; bind contracts via GGHttp in compose()",
        lineRe: /from\s*["']express["']|require\(\s*["']express["']\s*\)/,
        message: "Express server — grest-ts serves contracts through `new GGHttp(server).http(Api, impl)`",
    },
    {
        id: "GR005",
        severity: "error",
        convention: "§11 — no decorators for routing or DI",
        lineRe: /^\s*@(Controller|Injectable|Module|Get|Post|Put|Delete|Patch|Inject)\s*\(/,
        message: "NestJS-style routing/DI decorator — grest-ts uses plain classes wired in compose()",
    },
    {
        id: "GR009",
        severity: "warning",
        convention: "kratt CLAUDE.md / §9 — never hand-roll HTTP/socket; use `<Api>.createClient()` / `.createImpl()`",
        lineRe: /(?:from\s*["'](?:axios|node-fetch|got|ws)["'])|new\s+WebSocket\s*\(/,
        message: "Hand-rolled HTTP/WebSocket client — call another service via its typed `Api.createClient()` (schema-checked, discovery-aware)",
    },
    {
        id: "GR010",
        severity: "warning",
        convention: "kratt CLAUDE.md — config via GGSetting/GGSecret/GGResource, never hardcoded",
        lineRe: /["']https?:\/\/(?!localhost|127\.0\.0\.1|example\.|0\.0\.0\.0)[^"']+["']/,
        message: "Hardcoded URL — resolve from a `GGSetting`/`GGResource` instead of embedding it",
    },
    {
        id: "GR011",
        severity: "warning",
        convention: "kratt CLAUDE.md — read GG* config via `.get()` at point of use, never cache at module scope",
        lineRe: /^(?:export\s+)?(?:const|let)\s+\w+\s*=\s*[^=].*\b(?:GGSetting|GGSecret|GGResource|[A-Z]\w*(?:Setting|Secret|Resource|Config))\b[^=]*\.get\(\)\s*;?\s*$/,
        message: "Config `.get()` cached at module scope — pins the value at load and defeats `GGTest.with()` overrides; call `.get()` where the value is used",
    },
]

// Multi-line rule: errors:[...] arrays missing SERVER_ERROR (contract files only).
function scanServerError(content) {
    if (!/GGContractClass/.test(content)) return []
    const out = []
    const re = /errors\s*:\s*\[([\s\S]*?)\]/g
    let m
    while ((m = re.exec(content))) {
        if (!/\bSERVER_ERROR\b/.test(m[1])) {
            out.push({line: lineAt(content, m.index), message: "Contract method `errors` array is missing `SERVER_ERROR` — SKILL.md §1/§11 says every method should declare it"})
        }
    }
    return out
}

const findings = []
for (const file of files) {
    let content
    try {
        content = readFileSync(file, "utf8")
    } catch {
        continue
    }
    const lines = content.split("\n")

    for (const rule of RULES) {
        if (rule.appliesTo && !rule.appliesTo(file)) continue
        if (rule.scan) {
            for (const f of rule.scan(content)) {
                findings.push({file, rule: rule.id, severity: rule.severity, convention: rule.convention, ...f})
            }
        } else if (rule.lineRe) {
            lines.forEach((text, i) => {
                if (rule.lineRe.test(text)) {
                    findings.push({file, line: i + 1, rule: rule.id, severity: rule.severity, convention: rule.convention, message: rule.message, snippet: text.trim()})
                }
            })
        }
    }
    for (const f of scanServerError(content)) {
        findings.push({file, rule: "GR007", severity: "warning", convention: "§1 / §11 — contract methods should include SERVER_ERROR", ...f, snippet: (lines[f.line - 1] || "").trim()})
    }
}

findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)

if (asJson) {
    process.stdout.write(JSON.stringify({findings, fileCount: files.length}, null, 2) + "\n")
} else {
    if (!findings.length) {
        console.log(`grest-ts conventions: no mechanical violations in ${files.length} file(s).`)
    } else {
        let cur = null
        for (const f of findings) {
            if (f.file !== cur) {
                cur = f.file
                console.log(`\n${cur}`)
            }
            console.log(`  ${f.severity === "error" ? "ERROR" : "warn "} ${f.rule} L${f.line}: ${f.message}`)
        }
        console.log(`\n${findings.length} finding(s) across ${files.length} file(s).`)
    }
}

process.exit(findings.some(f => f.severity === "error") ? 1 : 0)
