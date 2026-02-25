// Documentation site configuration.
// Defines the complete sidebar tree — order, grouping, and labels match the UI exactly.
// Each entry is either a package name (string) or a group ({ groupName: [packages] }).

export type DocEntry = string | Record<string, string[]>

export const DOC_TREE: Record<string, DocEntry[]> = {
    "Core": [
        {http: ["http", "file-http", "websocket"]},
        {schema: ["schema", "file"]},
        {testkit: ["testkit-runtime", "testkit", "testkit-vitest"]},
        "context",
        "create-starter",
        "locator",
        "runtime",
        {config: ["config", "config-aws"]},
        {discovery: ["discovery", "discovery-local", "discovery-static"]},
        {logger: ["logger", "logger-console"]},
        {trace: ["trace", "trace-http"]},
        "metrics",
    ],
    "Production": [
        {config: ["config", "config-aws"]},
        {discovery: ["discovery", "discovery-local", "discovery-static"]},
        {logger: ["logger", "logger-console"]},
        {trace: ["trace", "trace-http"]},
        "metrics",
    ],
    "Integrations": [
        {db: ["db-mysql", "db-postgre"]},
        "sql",
        "struct",
    ],
    "Internals": [
        "common",
        "ipc",
    ],
}

export const COLLAPSED_CATEGORIES = new Set(["Internals"])

// ── Helpers ─────────────────────────────────────────────────────────────

/** Lowercase slug used in URL paths, e.g. "Core" → "core" */
export function categorySlug(label: string): string {
    return label.toLowerCase()
}

const _packageToCategory = new Map<string, string>()
for (const [label, entries] of Object.entries(DOC_TREE)) {
    const slug = categorySlug(label)
    for (const entry of entries) {
        if (typeof entry === "string") {
            _packageToCategory.set(entry, slug)
        } else {
            for (const packages of Object.values(entry)) {
                for (const pkg of packages) _packageToCategory.set(pkg, slug)
            }
        }
    }
}

export function getDocCategory(name: string): string {
    return _packageToCategory.get(name) ?? "core"
}
