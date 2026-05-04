// Documentation site configuration.
// Defines the complete sidebar tree — order, grouping, and labels match the UI exactly.
// Each entry is either a package name (string) or a group ({ groupName: [packages] }).

export type DocEntry = string | Record<string, string[]>

export const DOC_TREE: Record<string, DocEntry[]> = {
    "Starter": [
        "create-starter",
    ],
    "Tooling": [
        "cli",
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
    "Libraries": [
        {db: ["db-mysql", "db-postgre", "db-dynamodb"]},
        {docs: ["api-docs", "openapi", "asyncapi"]},
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
