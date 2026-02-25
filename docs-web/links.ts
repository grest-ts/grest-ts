// Centralized documentation link index.
// Keeps all cross-reference URLs in one place so changes propagate everywhere.
//
// In markdown READMEs, use @-prefixed placeholders inside links:
//   [text](@guide/discovery)        → resolves to a guide page
//   [text](@pkg/discovery-static)   → resolves to a package page
//
// generate.ts rewrites these to VitePress-compatible paths during doc generation.

/** Guide pages — add entries here as guides are created. */
export const GUIDE_LINKS: Record<string, string> = {
    "discovery": "/guide/discovery",
}

/**
 * Resolve a @-prefixed link placeholder to a docs-web path.
 * Returns undefined for unrecognized keys (left as-is in output).
 */
export function resolveDocLink(key: string): string | undefined {
    if (key.startsWith("guide/")) {
        const slug = key.slice("guide/".length)
        return GUIDE_LINKS[slug]
    }
    if (key.startsWith("pkg/")) {
        const name = key.slice("pkg/".length)
        return `/packages/${name}`
    }
    return undefined
}
