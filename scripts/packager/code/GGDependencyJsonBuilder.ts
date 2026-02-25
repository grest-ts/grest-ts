import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { PackagerFile } from "./PackagerFile"
import type { GGPackageInfo } from "./GGParser"

export interface DependencyNode {
    name: string
    description: string
    flags: {
        node: boolean
        browser: boolean
        testkit: boolean
        hidden: boolean
        implementation: boolean
        npm: boolean
    }
    layer: number
    color: string
    category: "core" | "libs" | "tooling" // Package category based on folder
    group?: string // Folder group name for grouped packages (e.g., "events" for packages in events/)
    readme?: string // README.md content if available
}

export interface DependencyEdge {
    from: string
    to: string
}

export interface DependencyGraph {
    nodes: DependencyNode[]
    edges: DependencyEdge[]
    generated: string
}

// Category-based colors
const CATEGORY_COLORS = {
    core: "#4E79A7",      // Blue
    libs: "#59A14F",      // Green
    tooling: "#F28E2B",   // Orange
}

// Darker versions for implementations
const CATEGORY_COLORS_DARK = {
    core: "#1E3250",      // Dark blue
    libs: "#2A4A25",      // Dark green
    tooling: "#7A4515",   // Dark orange
}

/**
 * Builds a JSON file with the package dependency graph.
 * Used by the interactive HTML dependency viewer.
 */
export class GGDependencyJsonBuilder {
    constructor(
        private readonly packages: GGPackageInfo[],
        private readonly rootDir: string,
        private readonly outputPath: string = "docs/dependencies.json"
    ) {}

    build(): PackagerFile {
        const graph = this.generateGraph()
        return PackagerFile.json(join(this.rootDir, this.outputPath), graph)
    }

    private getDependencies(pkg: GGPackageInfo, packageNames: Set<string>): string[] {
        const deps = new Set<string>()

        for (const dep of pkg.imports.gg) {
            if (packageNames.has(dep) && dep !== pkg.shortName) {
                deps.add(dep)
            }
        }

        if (pkg.config.references) {
            for (const ref of pkg.config.references) {
                if (packageNames.has(ref) && ref !== pkg.shortName) {
                    deps.add(ref)
                }
            }
        }

        return Array.from(deps).sort()
    }

    private calculateLayers(depGraph: Map<string, string[]>): Map<string, number> {
        const dependents = new Map<string, Set<string>>()
        for (const pkg of depGraph.keys()) {
            dependents.set(pkg, new Set())
        }
        for (const [pkg, deps] of depGraph) {
            for (const dep of deps) {
                dependents.get(dep)?.add(pkg)
            }
        }

        const layers = new Map<string, number>()
        const assigned = new Set<string>()
        let currentLayer = 0

        while (assigned.size < depGraph.size) {
            const layerPackages: string[] = []
            for (const pkg of depGraph.keys()) {
                if (assigned.has(pkg)) continue

                const pkgDependents = dependents.get(pkg) || new Set()
                const allDependentsAssigned = Array.from(pkgDependents).every(d => assigned.has(d))

                if (allDependentsAssigned) {
                    layerPackages.push(pkg)
                }
            }

            if (layerPackages.length === 0) {
                for (const pkg of depGraph.keys()) {
                    if (!assigned.has(pkg)) {
                        layers.set(pkg, currentLayer)
                        assigned.add(pkg)
                    }
                }
                break
            }

            for (const pkg of layerPackages) {
                layers.set(pkg, currentLayer)
                assigned.add(pkg)
            }
            currentLayer++
        }

        return layers
    }

    private generateGraph(): DependencyGraph {
        const packageNames = new Set(this.packages.map(p => p.shortName))
        const packageByName = new Map(this.packages.map(p => [p.shortName, p]))

        // Build dependency graph
        const depGraph = new Map<string, string[]>()
        for (const pkg of this.packages) {
            depGraph.set(pkg.shortName, this.getDependencies(pkg, packageNames))
        }

        // Calculate layers
        const layers = this.calculateLayers(depGraph)

        // Group packages by folder structure (e.g., packages/events/events-aws -> group "events")
        const sortedPackages = this.packages.map(p => p.shortName).sort()
        const packageGroups = new Map<string, string>() // package -> group folder name

        // Extract group from folder path
        for (const pkg of this.packages) {
            const pathParts = pkg.relativePath.replace(/\\/g, "/").split("/")
            // If path is like "packages/events/events-aws" (3 parts), group is "events"
            if (pathParts.length >= 3) {
                const groupFolder = pathParts[1] // e.g., "events", "db", "type"
                packageGroups.set(pkg.shortName, groupFolder)
            }
        }

        // Determine category from folder path
        const getCategory = (relativePath: string): "core" | "libs" | "tooling" => {
            const normalizedPath = relativePath.replace(/\\/g, "/")
            if (normalizedPath.startsWith("packages-libs/")) return "libs"
            if (normalizedPath.startsWith("packages-tooling/")) return "tooling"
            if (normalizedPath.startsWith("packages/")) return "core"
            // Root-level packages are tooling
            return "tooling"
        }

        // Assign colors based on category - implementations get darker colors
        const getColor = (pkg: GGPackageInfo): string => {
            const category = getCategory(pkg.relativePath)
            const isImplementation = !!pkg.config.implementationFor
            return isImplementation ? CATEGORY_COLORS_DARK[category] : CATEGORY_COLORS[category]
        }

        // Build nodes
        const nodes: DependencyNode[] = sortedPackages.map(name => {
            const pkg = packageByName.get(name)!
            const group = packageGroups.get(name)

            // Read README.md if it exists
            let readme: string | undefined
            const readmePath = join(pkg.path, "README.md")
            if (existsSync(readmePath)) {
                try {
                    readme = readFileSync(readmePath, "utf-8")
                } catch {
                    // Silently ignore read errors
                }
            }

            const node: DependencyNode = {
                name,
                description: pkg.config.description,
                flags: {
                    node: !!pkg.config.targets?.node,
                    browser: !!pkg.config.targets?.browser,
                    testkit: !!pkg.config.extendsTestKit,
                    hidden: !!pkg.config.hidden,
                    implementation: !!pkg.config.implementationFor,
                    npm: !!pkg.config.publishToNpm,
                },
                layer: layers.get(name) || 0,
                color: getColor(pkg),
                category: getCategory(pkg.relativePath),
            }
            if (group) {
                node.group = group
            }
            if (readme) {
                node.readme = readme
            }
            return node
        })

        // Build edges
        const edges: DependencyEdge[] = []
        for (const pkg of sortedPackages) {
            const deps = depGraph.get(pkg) || []
            for (const dep of [...deps].sort()) {
                edges.push({ from: pkg, to: dep })
            }
        }

        return {
            nodes,
            edges,
            generated: new Date().toISOString(),
        }
    }
}
