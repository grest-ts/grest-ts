import { join } from "path"
import { PackagerFile } from "./PackagerFile"
import type { GGPackageInfo } from "./GGParser"

const ICON_NODE = "🟢"
const ICON_BROWSER = "🌐"

// Color palette - distinct colors for packages
const COLORS = [
    "#4E79A7", // blue
    "#F28E2B", // orange
    "#E15759", // red
    "#76B7B2", // teal
    "#59A14F", // green
    "#EDC948", // yellow
    "#B07AA1", // purple
    "#FF9DA7", // pink
    "#9C755F", // brown
    "#BAB0AC", // gray
    "#86BCB6", // light teal
    "#8CD17D", // light green
    "#B6992D", // olive
    "#499894", // dark teal
    "#D37295", // rose
    "#A0CBE8", // light blue
    "#FFBE7D", // light orange
    "#D4A6C8", // lavender
]

/**
 * Builds a Mermaid diagram showing the package dependency tree.
 * Only used during full builds, not for single package generation.
 */
export class GGMermaidBuilder {
    private readonly packages: GGPackageInfo[]
    private readonly rootDir: string
    private readonly outputPath: string
    constructor(
        packages: GGPackageInfo[],
        rootDir: string,
        outputPath: string = "DEPENDENCIES.md"
    ) {
        this.packages = packages
        this.rootDir = rootDir
        this.outputPath = outputPath
    }

    /**
     * Convert package name to human-readable format
     * e.g., "code-generator" → "Code Generator"
     */
    private humanize(name: string): string {
        return name
            .split("-")
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ")
    }

    /**
     * Get target icons for a package
     */
    private getTargetIcons(pkg: GGPackageInfo): string {
        const icons: string[] = []
        const targets = pkg.config.targets
        if (targets.node) icons.push(ICON_NODE)
        if (targets.browser) icons.push(ICON_BROWSER)
        return icons.join("")
    }

    /**
     * Build the Mermaid diagram file
     */
    build(): PackagerFile {
        const mermaidContent = this.generateMermaidDiagram()
        return PackagerFile.markdown(join(this.rootDir, this.outputPath), mermaidContent)
    }

    /**
     * Get dependencies for a package (combining auto-discovered and manual references)
     */
    private getDependencies(pkg: GGPackageInfo, packageNames: Set<string>): string[] {
        const deps = new Set<string>()

        // Auto-discovered @grest-ts/* imports
        for (const dep of pkg.imports.gg) {
            if (packageNames.has(dep) && dep !== pkg.shortName) {
                deps.add(dep)
            }
        }

        // Manual references from config
        if (pkg.config.references) {
            for (const ref of pkg.config.references) {
                if (packageNames.has(ref) && ref !== pkg.shortName) {
                    deps.add(ref)
                }
            }
        }

        return Array.from(deps).sort()
    }

    /**
     * Calculate layers using reverse topological sort.
     * Packages with no dependents (nothing imports them) are at layer 0 (top).
     * Then packages only used by layer 0, etc.
     */
    private calculateLayers(depGraph: Map<string, string[]>): Map<string, number> {
        // Build reverse graph (who depends on me?)
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

        // Keep assigning layers until all packages are assigned
        while (assigned.size < depGraph.size) {
            // Find packages where all dependents are already assigned
            const layerPackages: string[] = []
            for (const pkg of depGraph.keys()) {
                if (assigned.has(pkg)) continue

                const pkgDependents = dependents.get(pkg) || new Set()
                const allDependentsAssigned = Array.from(pkgDependents).every(d => assigned.has(d))

                if (allDependentsAssigned) {
                    layerPackages.push(pkg)
                }
            }

            // If no progress (cycle), assign remaining to current layer
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

    /**
     * Generate the Mermaid diagram content with layered layout
     */
    private generateMermaidDiagram(): string {
        const packageNames = new Set(this.packages.map(p => p.shortName))

        // Build dependency graph
        const depGraph = new Map<string, string[]>()
        for (const pkg of this.packages) {
            depGraph.set(pkg.shortName, this.getDependencies(pkg, packageNames))
        }

        // Calculate layers (reverse topological - roots at top)
        const depths = this.calculateLayers(depGraph)

        // Group packages by depth
        const layers = new Map<number, string[]>()
        for (const [pkg, depth] of depths) {
            if (!layers.has(depth)) layers.set(depth, [])
            layers.get(depth)!.push(pkg)
        }

        // Sort layers (0 = top/roots, higher = deeper dependencies)
        const sortedDepths = Array.from(layers.keys()).sort((a, b) => a - b)

        const lines: string[] = [
            "# Package Dependencies",
            "",
            `> ${ICON_NODE} Node.js &nbsp; ${ICON_BROWSER} Browser`,
            "",
            "```mermaid",
            "flowchart TB"
        ]

        // Assign colors and icons to packages (sorted for consistency)
        const sortedPackages = this.packages.map(p => p.shortName).sort()
        const packageColors = new Map<string, string>()
        const packageIcons = new Map<string, string>()
        const packageByName = new Map(this.packages.map(p => [p.shortName, p]))
        sortedPackages.forEach((pkg, i) => {
            packageColors.set(pkg, COLORS[i % COLORS.length])
            const pkgInfo = packageByName.get(pkg)
            if (pkgInfo) {
                packageIcons.set(pkg, this.getTargetIcons(pkgInfo))
            }
        })

        // Add subgraphs for each layer
        for (const depth of sortedDepths) {
            const pkgs = layers.get(depth)!.sort()
            lines.push(`    subgraph L${depth}[" "]`)
            for (const pkg of pkgs) {
                const icons = packageIcons.get(pkg) || ""
                lines.push(`        ${pkg}["${pkg} ${icons}"]`)
            }
            lines.push("    end")
        }

        // Add edges and track their indices for styling
        const edges: { from: string; to: string }[] = []
        for (const pkg of sortedPackages) {
            const deps = depGraph.get(pkg) || []
            for (const dep of [...deps].sort()) {
                edges.push({ from: pkg, to: dep })
            }
        }

        for (const edge of edges) {
            lines.push(`    ${edge.from} --> ${edge.to}`)
        }

        // Add node styles
        for (const [pkg, color] of packageColors) {
            lines.push(`    style ${pkg} fill:${color},stroke:${color},color:#fff`)
        }

        // Add edge styles (linkStyle uses 0-based index)
        edges.forEach((edge, i) => {
            const color = packageColors.get(edge.from)!
            lines.push(`    linkStyle ${i} stroke:${color},stroke-width:2px`)
        })

        lines.push("```")

        // Add per-package diagrams
        lines.push("")
        lines.push("---")
        lines.push("")
        lines.push("## Per-Package Views")

        for (const pkg of sortedPackages) {
            const pkgDiagram = this.generatePackageDiagram(pkg, depGraph, packageColors, packageIcons)
            lines.push("")
            lines.push(...pkgDiagram)
        }

        return lines.join("\n") + "\n"
    }

    /**
     * Generate a focused diagram for a single package showing dependents and dependencies
     */
    private generatePackageDiagram(
        pkg: string,
        depGraph: Map<string, string[]>,
        packageColors: Map<string, string>,
        packageIcons: Map<string, string>
    ): string[] {
        // Get dependencies (what this package depends on)
        const dependencies = depGraph.get(pkg) || []

        // Get dependents (what depends on this package)
        const dependents: string[] = []
        for (const [p, deps] of depGraph) {
            if (deps.includes(pkg)) {
                dependents.push(p)
            }
        }
        dependents.sort()

        const humanName = this.humanize(pkg)
        const pkgIcons = packageIcons.get(pkg) || ""
        const lines: string[] = [
            `### ${humanName}`,
            "",
            "```mermaid",
            "flowchart TB"
        ]

        // Add subgraph for dependents (top)
        if (dependents.length > 0) {
            lines.push(`    subgraph Dependents[" "]`)
            for (const dep of dependents) {
                const icons = packageIcons.get(dep) || ""
                lines.push(`        ${dep}["${dep} ${icons}"]`)
            }
            lines.push("    end")
        }

        // Add the package itself (middle)
        lines.push(`    subgraph Package[" "]`)
        lines.push(`        ${pkg}["${pkg} ${pkgIcons}"]`)
        lines.push("    end")

        // Add subgraph for dependencies (bottom)
        if (dependencies.length > 0) {
            lines.push(`    subgraph Dependencies[" "]`)
            for (const dep of dependencies) {
                const icons = packageIcons.get(dep) || ""
                lines.push(`        ${dep}["${dep} ${icons}"]`)
            }
            lines.push("    end")
        }

        // Add edges from dependents to this package
        const edges: { from: string; to: string }[] = []
        for (const dep of dependents) {
            edges.push({ from: dep, to: pkg })
        }

        // Add edges from this package to its dependencies
        for (const dep of dependencies) {
            edges.push({ from: pkg, to: dep })
        }

        for (const edge of edges) {
            lines.push(`    ${edge.from} --> ${edge.to}`)
        }

        // Style all nodes
        const allNodes = new Set([pkg, ...dependents, ...dependencies])
        for (const node of allNodes) {
            const color = packageColors.get(node)!
            lines.push(`    style ${node} fill:${color},stroke:${color},color:#fff`)
        }

        // Style edges
        edges.forEach((edge, i) => {
            const color = packageColors.get(edge.from)!
            lines.push(`    linkStyle ${i} stroke:${color},stroke-width:2px`)
        })

        lines.push("```")
        return lines
    }
}
