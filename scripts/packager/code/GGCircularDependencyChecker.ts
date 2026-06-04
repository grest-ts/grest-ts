import type { GGPackageInfo } from "./GGParser"

/**
 * Detects circular dependencies between packages.
 * Circular dependencies are a code smell and can cause runtime issues with ES modules.
 */
export class GGCircularDependencyChecker {
    private packageMap: Map<string, GGPackageInfo>
    private readonly packages: GGPackageInfo[]

    constructor(packages: GGPackageInfo[]) {
        this.packages = packages
        this.packageMap = new Map(packages.map(p => [p.shortName, p]))
    }

    /**
     * Check for circular dependencies and throw an error if found.
     */
    check(): void {
        const cycles = this.detectCycles()

        if (cycles.length > 0) {
            const cycleDescriptions = cycles.map(cycle =>
                `  ${cycle.join(' → ')} → ${cycle[0]}`
            ).join('\n')

            throw new Error(
                `Circular dependencies detected between packages:\n${cycleDescriptions}\n\n` +
                `Circular dependencies can cause runtime issues with ES modules (undefined imports).\n` +
                `Please refactor to remove the cycles.`
            )
        }
    }

    /**
     * Detect all cycles in the dependency graph using DFS.
     * Returns an array of cycles, where each cycle is an array of package names.
     */
    private detectCycles(): string[][] {
        const graph = this.buildDependencyGraph()
        const cycles: string[][] = []
        const visited = new Set<string>()
        const inStack = new Set<string>()
        const path: string[] = []

        const dfs = (node: string) => {
            visited.add(node)
            inStack.add(node)
            path.push(node)

            const deps = graph.get(node) || []
            for (const dep of deps) {
                if (inStack.has(dep)) {
                    // Found a cycle - extract it from path
                    const cycleStart = path.indexOf(dep)
                    const cycle = path.slice(cycleStart)
                    cycles.push(cycle)
                } else if (!visited.has(dep)) {
                    dfs(dep)
                }
            }

            path.pop()
            inStack.delete(node)
        }

        // Run DFS from all nodes
        for (const pkg of this.packages) {
            if (!visited.has(pkg.shortName)) {
                dfs(pkg.shortName)
            }
        }

        return cycles
    }

    /**
     * Build dependency graph from package imports.
     */
    private buildDependencyGraph(): Map<string, string[]> {
        const graph = new Map<string, string[]>()

        for (const pkg of this.packages) {
            // Get @grest-ts/* imports that are actual packages (not self)
            const deps = pkg.imports.gg.filter(dep =>
                dep !== pkg.shortName &&
                this.packageMap.has(dep)
            )

            // Add manual references from config
            if (pkg.config.references) {
                for (const ref of pkg.config.references) {
                    if (ref !== pkg.shortName && this.packageMap.has(ref)) {
                        if (!deps.includes(ref)) {
                            deps.push(ref)
                        }
                    }
                }
            }

            graph.set(pkg.shortName, deps)
        }

        return graph
    }
}
