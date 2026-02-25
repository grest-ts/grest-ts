// Documentation site configuration.
// Defines the complete sidebar tree — order, grouping, and labels match the UI exactly.
// Each entry is either a package name (string) or a group ({ groupName: [packages] }).

export type DocEntry = string | Record<string, string[]>

export const DOC_TREE: Record<string, DocEntry[]> = {
    "Starter": [
        "create-starter",
    ],
    "Framework": [
        {schema: ["schema", "schema-file"]},
        {http: ["http", "http-file", "websocket"]},
        "runtime",
        {testkit: ["testkit", "testkit-runtime", "testkit-vitest"]},
    ],
    "Platform": [
        {config: ["config", "config-aws"]},
        {discovery: ["discovery", "discovery-local", "discovery-static"]},
        {logger: ["logger", "logger-console"]},
        "context",
        "locator",
        "metrics",
        {trace: ["trace", "trace-http"]},
    ],
    "Wrappers": [
        {db: ["db-mysql", "db-postgre"]},
    ],
    "Useful": [
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
