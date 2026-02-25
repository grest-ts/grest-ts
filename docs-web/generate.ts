// Generates VitePress documentation site from package READMEs and guide docs.
// Reads docs/dependencies.json for package metadata, discovers package directories
// for supplementary README-*.md files, and generates sidebar configuration.
//
// Output: docs-web/src/ (ALL generated, gitignored)
// Usage: tsx generate.ts

import {readFileSync, readdirSync, existsSync, rmSync, mkdirSync, writeFileSync, cpSync, watch} from "fs"
import {join, resolve, relative} from "path"
import {DOC_TREE, COLLAPSED_CATEGORIES, categorySlug, getDocCategory, type DocEntry} from "./config"

const ROOT = resolve(import.meta.dirname, "..")
const DOCS_WEB = join(ROOT, "docs-web")
const DOCS_SRC = join(DOCS_WEB, "src")

// ── Types ──────────────────────────────────────────────────────────────

interface DependencyNode {
    name: string
    description: string
    flags: { node: boolean; browser: boolean; testkit: boolean; hidden: boolean; implementation: boolean; npm: boolean }
    layer: number
    color: string
    category: string
    group?: string
    readme?: string
}

interface SidebarItem {
    text: string
    link?: string
    collapsed?: boolean
    items?: SidebarItem[]
}

// ── Package discovery (reused from grest.4.build.ts) ───────────────────

function discoverPackages(): Map<string, string> {
    const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"))
    const workspaces: string[] = rootPkg.workspaces ?? []
    const packages = new Map<string, string>()

    for (const pattern of workspaces) {
        if (pattern.endsWith("/*")) {
            const baseDir = join(ROOT, pattern.slice(0, -2))
            if (!existsSync(baseDir)) continue
            for (const entry of readdirSync(baseDir, {withFileTypes: true})) {
                if (!entry.isDirectory() || entry.name === "node_modules") continue
                const dir = join(baseDir, entry.name)
                const pkgPath = join(dir, "package.json")
                if (!existsSync(pkgPath)) continue
                const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
                if (pkg.name?.startsWith("@grest-ts/")) {
                    packages.set(pkg.name.replace("@grest-ts/", ""), dir)
                }
            }
        } else {
            const dir = join(ROOT, pattern)
            const pkgPath = join(dir, "package.json")
            if (!existsSync(pkgPath)) continue
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
            if (pkg.name?.startsWith("@grest-ts/")) {
                packages.set(pkg.name.replace("@grest-ts/", ""), dir)
            }
        }
    }
    return packages
}

// ── Text transformations ───────────────────────────────────────────────

function stripBanner(content: string): string {
    return content.replace(/<!-- GREST-TS-BANNER-START -->[\s\S]*?<!-- GREST-TS-BANNER-END -->\s*/g, "")
}

function addFrontmatter(content: string, title: string, description?: string): string {
    const safeTitle = title.replace(/"/g, '\\"')
    let fm = `---\ntitle: "${safeTitle}"\n`
    if (description) {
        fm += `description: "${description.replace(/"/g, '\\"')}"\n`
    }
    return fm + `---\n\n` + content
}

function titleize(slug: string): string {
    return slug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

function normalize(content: string): string {
    return content.replace(/\r\n/g, "\n")
}

/** Standard HTML elements that VitePress/Vue should handle natively */
const HTML_TAGS = new Set([
    "a", "abbr", "b", "blockquote", "br", "caption", "code", "col", "colgroup", "dd", "del",
    "details", "div", "dl", "dt", "em", "figcaption", "figure", "footer", "h1", "h2", "h3",
    "h4", "h5", "h6", "header", "hr", "i", "iframe", "img", "input", "ins", "kbd", "li",
    "main", "mark", "nav", "ol", "p", "picture", "pre", "s", "section", "small", "source",
    "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "th", "thead", "tr",
    "u", "ul", "video",
])

/**
 * Escape angle-bracket patterns (e.g. TypeScript generics `<Type>`) that sit outside
 * fenced code blocks and inline code spans, so Vue's template compiler doesn't choke.
 */
function escapeVueSyntax(content: string): string {
    const lines = content.split("\n")
    let inFence = false
    return lines.map(line => {
        if (/^\s*```/.test(line)) inFence = !inFence
        if (inFence) return line
        // Match inline code OR angle-bracket tags; leave code spans and standard HTML untouched
        return line.replace(
            /(`[^`]*`)|(<\/?([a-zA-Z][\w,\s]*?)>)/g,
            (match, code, tag, inner) => {
                if (code) return match
                const name = inner.trim().split(/[\s,/]/)[0].toLowerCase()
                if (HTML_TAGS.has(name)) return match
                return tag.replace(/</g, "&lt;").replace(/>/g, "&gt;")
            },
        )
    }).join("\n")
}

/** Rewrite ./README-*.md links to sibling doc pages within the same category directory */
function rewritePackageLinks(content: string, pkgName: string): string {
    return content.replace(
        /\(\.\/README-([^)]+)\.md\)/g,
        (_, suffix) => `(./${pkgName}-${suffix.toLowerCase()}.md)`
    )
}

/** Rewrite links in guide pages — package directory refs → doc paths, root README-*.md → guide */
function rewriteGuideLinks(content: string, dirToDocPath: Map<string, string>): string {
    // ./README-<slug>.md → /guide/<slug> for all discovered root guides
    const guideSlugs = new Set(GUIDE_DOCS.filter(d => d.slug !== "index").map(d => d.slug))
    content = content.replace(
        /\(\.\/README-([^)]+)\.md\)/g,
        (match, name) => {
            const slug = name.toLowerCase()
            return guideSlugs.has(slug) ? `(/guide/${slug})` : match
        }
    )
    // ./packages/... and ./packages-libs/... and ./packages-tooling/... → doc paths
    content = content.replace(
        /\(\.\/(packages[^)]*)\)/g,
        (match, relPath) => {
            const normalized = relPath.replace(/\\/g, "/")
            const docPath = dirToDocPath.get(normalized)
            return docPath ? `(${docPath})` : match
        }
    )
    // ./starter → GitHub link
    content = content.replace(
        /\(\.\/(starter)\)/g,
        "(https://github.com/grest-ts/grest-ts/tree/master/starter)"
    )
    return content
}

// ── Root-level README-*.md discovery ────────────────────────────────────

function discoverRootGuides(): { src: string; slug: string; title: string }[] {
    const entries: { src: string; slug: string; title: string }[] = []
    for (const file of readdirSync(ROOT)) {
        if (!/^README-.+\.md$/i.test(file)) continue
        const slug = file.replace(/^README-/i, "").replace(/\.md$/i, "").toLowerCase()
        const src = join(ROOT, file)
        const content = readFileSync(src, "utf-8")
        const headingMatch = content.match(/^#\s+(.+)$/m)
        const title = headingMatch ? headingMatch[1].trim() : titleize(slug)
        entries.push({src, slug, title})
    }
    return entries.sort((a, b) => a.slug.localeCompare(b.slug))
}

// ── Guide processing ───────────────────────────────────────────────────

const GUIDE_DOCS: { src: string; slug: string; title: string }[] = [
    {src: join(ROOT, "README.md"), slug: "index", title: "Framework Overview"},
    ...discoverRootGuides(),
]

function processGuides(dirToDocPath: Map<string, string>): void {
    const guideDir = join(DOCS_SRC, "guide")
    mkdirSync(guideDir, {recursive: true})

    for (const doc of GUIDE_DOCS) {
        if (!existsSync(doc.src)) {
            console.warn(`  WARN: guide source missing: ${doc.src}`)
            continue
        }
        let content = normalize(readFileSync(doc.src, "utf-8"))
        content = rewriteGuideLinks(content, dirToDocPath)
        content = escapeVueSyntax(content)
        writeFileSync(join(guideDir, `${doc.slug}.md`), addFrontmatter(content, doc.title))
    }
}

// ── Package processing ─────────────────────────────────────────────────

function processPackages(nodes: DependencyNode[], packageDirs: Map<string, string>): void {
    for (const node of nodes) {
        if (node.flags.hidden || !node.flags.npm) continue

        const docCat = getDocCategory(node.name)
        const catDir = join(DOCS_SRC, "packages", docCat)
        mkdirSync(catDir, {recursive: true})

        const dir = packageDirs.get(node.name)

        // Main README
        let content = ""
        if (dir && existsSync(join(dir, "README.md"))) {
            content = normalize(readFileSync(join(dir, "README.md"), "utf-8"))
        }

        content = stripBanner(content).trim()
        content = rewritePackageLinks(content, node.name)
        content = escapeVueSyntax(content)

        // Empty READMEs (just banner) → minimal page
        if (!content || content.length < 10) {
            content = `# @grest-ts/${node.name}\n\n${node.description}\n`
        }

        writeFileSync(
            join(catDir, `${node.name}.md`),
            addFrontmatter(content, `@grest-ts/${node.name}`, node.description)
        )

        // Copy image directories referenced by the README
        if (dir && existsSync(join(dir, "img"))) {
            cpSync(join(dir, "img"), join(catDir, "img"), {recursive: true})
        }

        // Supplementary README-*.md files
        if (dir) {
            for (const entry of readdirSync(dir)) {
                if (!/^README-.+\.md$/i.test(entry)) continue
                const suffix = entry.replace(/^README-/i, "").replace(/\.md$/i, "").toLowerCase()
                let subContent = normalize(readFileSync(join(dir, entry), "utf-8"))
                subContent = stripBanner(subContent).trim()
                subContent = rewritePackageLinks(subContent, node.name)
                subContent = escapeVueSyntax(subContent)

                if (!subContent || subContent.length < 10) continue

                writeFileSync(
                    join(catDir, `${node.name}-${suffix}.md`),
                    addFrontmatter(subContent, `@grest-ts/${node.name} — ${titleize(suffix)}`, node.description)
                )
            }
        }
    }
}

// ── Sidebar generation ─────────────────────────────────────────────────

function buildPackageItem(node: DependencyNode, packageDirs: Map<string, string>, useShortName?: boolean): SidebarItem {
    const docCat = getDocCategory(node.name)
    const link = `/packages/${docCat}/${node.name}`
    const text = useShortName ? titleize(node.name) : `@grest-ts/${node.name}`
    const item: SidebarItem = {text, link}

    const dir = packageDirs.get(node.name)
    if (dir) {
        const subPages: SidebarItem[] = []
        for (const entry of readdirSync(dir)) {
            if (!/^README-.+\.md$/i.test(entry)) continue
            const suffix = entry.replace(/^README-/i, "").replace(/\.md$/i, "").toLowerCase()
            subPages.push({
                text: titleize(suffix),
                link: `/packages/${docCat}/${node.name}-${suffix}`,
            })
        }
        if (subPages.length > 0) {
            item.items = subPages
            item.collapsed = true
        }
    }
    return item
}

function generateSidebar(nodesByName: Map<string, DependencyNode>, packageDirs: Map<string, string>): Record<string, SidebarItem[]> {
    // Guide sidebar
    const guideSidebar: SidebarItem[] = [{
        text: "Guide",
        items: GUIDE_DOCS.map(doc => ({
            text: doc.title,
            link: doc.slug === "index" ? "/guide/" : `/guide/${doc.slug}`,
        })),
    }]

    // Package sidebar — driven by DOC_TREE config
    const packagesSidebar: SidebarItem[] = []

    for (const [label, entries] of Object.entries(DOC_TREE)) {
        const slug = categorySlug(label)
        const items: SidebarItem[] = []

        for (const entry of entries) {
            if (typeof entry === "string") {
                const node = nodesByName.get(entry)
                if (node) items.push(buildPackageItem(node, packageDirs))
            } else {
                for (const [groupName, packages] of Object.entries(entry)) {
                    const groupItems = packages
                        .map(name => nodesByName.get(name))
                        .filter((n): n is DependencyNode => !!n)
                        .map(node => buildPackageItem(node, packageDirs))
                    if (groupItems.length > 0) {
                        items.push({
                            text: `@grest-ts/${groupName}*`,
                            link: `/packages/${slug}/${packages[0]}`,
                            collapsed: true,
                            items: groupItems,
                        })
                    }
                }
            }
        }

        const section: SidebarItem = {text: label, items}
        if (COLLAPSED_CATEGORIES.has(label)) section.collapsed = true
        packagesSidebar.push(section)
    }

    return {
        "/guide/": guideSidebar,
        "/packages/": packagesSidebar,
    }
}

// ── Main ───────────────────────────────────────────────────────────────

function main() {
    console.log("Generating documentation...\n")

    // Read dependencies.json
    const deps = JSON.parse(readFileSync(join(ROOT, "docs", "dependencies.json"), "utf-8"))
    const nodes: DependencyNode[] = deps.nodes
    console.log(`  ${nodes.length} packages in dependencies.json`)

    // Discover package directories
    const packageDirs = discoverPackages()
    console.log(`  ${packageDirs.size} package directories discovered`)

    // Build directory-to-doc-path map for guide link rewriting
    const dirToDocPath = new Map<string, string>()
    for (const node of nodes) {
        if (node.flags.hidden || !node.flags.npm) continue
        const dir = packageDirs.get(node.name)
        if (dir) {
            const relPath = relative(ROOT, dir).replace(/\\/g, "/")
            dirToDocPath.set(relPath, `/packages/${getDocCategory(node.name)}/${node.name}`)
        }
    }

    // Clean and recreate output directory
    if (existsSync(DOCS_SRC)) {
        rmSync(DOCS_SRC, {recursive: true, force: true})
    }
    mkdirSync(DOCS_SRC, {recursive: true})

    // Copy landing page into srcDir
    const landingPage = join(DOCS_WEB, "index.md")
    if (existsSync(landingPage)) {
        cpSync(landingPage, join(DOCS_SRC, "index.md"))
    }

    // Copy packages overview page into srcDir
    const packagesPage = join(DOCS_WEB, "packages.md")
    if (existsSync(packagesPage)) {
        const packagesDir = join(DOCS_SRC, "packages")
        mkdirSync(packagesDir, {recursive: true})
        cpSync(packagesPage, join(packagesDir, "index.md"))
    }

    // Copy static assets (logo) into srcDir/public
    const publicDir = join(DOCS_SRC, "public")
    mkdirSync(publicDir, {recursive: true})
    const logo = join(ROOT, "logo.png")
    if (existsSync(logo)) {
        cpSync(logo, join(publicDir, "logo.png"))
    }

    // Process guides
    processGuides(dirToDocPath)
    console.log("  Processed guide docs")

    // Process packages
    processPackages(nodes, packageDirs)
    const visible = nodes.filter(n => !n.flags.hidden && n.flags.npm).length
    console.log(`  Processed ${visible} package docs`)

    // Generate sidebar
    const nodesByName = new Map(nodes.filter(n => !n.flags.hidden && n.flags.npm).map(n => [n.name, n]))
    const sidebar = generateSidebar(nodesByName, packageDirs)
    writeFileSync(join(DOCS_SRC, "_generated_sidebar.json"), JSON.stringify(sidebar, null, 2) + "\n")
    console.log("  Generated sidebar configuration")

    console.log("\nDone.")
}

main()

// ── Watch mode ──────────────────────────────────────────────────────────

if (process.argv.includes("--watch")) {
    let timer: ReturnType<typeof setTimeout> | null = null

    const rebuild = (source: string) => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
            console.log(`\n  Change detected: ${source}`)
            try {
                main()
            } catch (e) {
                console.error("  Rebuild failed:", e)
            }
            console.log("  Watching for changes...")
        }, 300)
    }

    // Watch workspace package dirs for README changes
    const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"))
    for (const pattern of (rootPkg.workspaces as string[] ?? [])) {
        const baseDir = join(ROOT, pattern.endsWith("/*") ? pattern.slice(0, -2) : pattern)
        if (existsSync(baseDir)) {
            watch(baseDir, {recursive: true}, (_, filename) => {
                if (filename && /readme/i.test(filename) && filename.endsWith(".md")) {
                    rebuild(filename)
                }
            })
        }
    }

    // Watch docs/ for dependency metadata changes
    if (existsSync(join(ROOT, "docs"))) {
        watch(join(ROOT, "docs"), {recursive: true}, (_, filename) => {
            if (filename) rebuild(`docs/${filename}`)
        })
    }

    // Watch docs-web/index.md (landing page) and packages.md (overview page)
    watch(join(DOCS_WEB, "index.md"), () => rebuild("docs-web/index.md"))
    watch(join(DOCS_WEB, "packages.md"), () => rebuild("docs-web/packages.md"))

    // Watch root README, logo, and discovered root README-*.md files
    const rootWatchFiles = ["README.md", "logo.png", ...GUIDE_DOCS.filter(d => d.slug !== "index").map(d => `README-${d.slug}.md`)]
    for (const file of rootWatchFiles) {
        if (existsSync(join(ROOT, file))) {
            watch(join(ROOT, file), () => rebuild(file))
        }
    }

    console.log("  Watching for changes...")
}
