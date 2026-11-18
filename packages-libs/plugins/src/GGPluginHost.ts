import type {GGContribution, GGPoint, GGPointEntry} from "./GGPoint"

export interface GGPlugin<F> {
    readonly name: string
    readonly facet: F
}

export interface GGDroppedPlugin {
    readonly name: string
    /** The dependency that is off. */
    readonly missing: string
}

export interface GGPluginHostOptions<F, P extends Readonly<Record<string, F>> = Readonly<Record<string, F>>> {
    /** This layer's facet per plugin name. */
    plugins: P
    /** Plugins of this host that must be on, and come first. */
    dependsOn?: (name: string) => readonly string[] | undefined
    /** Which plugins this host runs; one whose dependency is off is dropped. Default: all. */
    isOn?: (name: string) => boolean
    /** Where a plugin's config keys go. Default: `plugins/<name>/`. */
    configPrefix?: (name: string) => string
}

/** What a facet may carry, by convention, besides its own fields. */
export interface GGPluginFacet<TConfig = unknown> {
    /** Static contributions to extension points. */
    provides?: readonly GGPointEntry[]
    /** Called once by {@link GGPluginHost.configTree}, inside the app's `GGConfig.define`. */
    config?(prefix: string): TConfig
    /** Local (dev) values for the keys `config` declared. */
    localConfig?(): unknown
}

type ConfigOf<X> = X extends {config?: (prefix: string) => infer C} ? C : never

/** Each plugin's config handles under its name, for the plugins that declare config. */
export type GGPluginConfigTree<P> = {[K in keyof P as [ConfigOf<P[K]>] extends [void] ? never : unknown extends ConfigOf<P[K]> ? never : K]: ConfigOf<P[K]>}

type AnyFn = (...args: any[]) => unknown
type PhaseOf<F> = Exclude<{[K in keyof F]-?: NonNullable<F[K]> extends AnyFn ? K : never}[keyof F], "config" | "localConfig">
type PhaseCtx<F, K extends keyof F> = NonNullable<F[K]> extends (ctx: infer C, ...rest: any[]) => unknown ? C : never

/**
 * Runs one layer's plugins in one process: orders them by `dependsOn`, drops the ones that are off, runs lifecycle
 * phases and collects what they provide to extension points.
 */
export class GGPluginHost<F extends object, P extends Readonly<Record<string, F>> = Readonly<Record<string, F>>> {

    /** Every plugin, dependencies first, then by name. */
    public readonly all: readonly GGPlugin<F>[]
    /** The plugins this host runs, in {@link all}'s order. */
    public readonly active: readonly GGPlugin<F>[]
    /** Plugins switched on whose dependency is off. */
    public readonly dropped: readonly GGDroppedPlugin[]

    private readonly provided = new Map<string, {point: GGPoint<unknown>, contributions: {from: string, c: GGContribution<unknown>}[]}>()
    private readonly configs = new Map<string, unknown>()
    private readonly configPrefix: (name: string) => string

    public constructor(options: GGPluginHostOptions<F, P>) {
        const deps = (p: GGPlugin<F>) => options.dependsOn?.(p.name) ?? []
        const plugins = Object.keys(options.plugins).sort().map(name => ({name, facet: options.plugins[name]}))
        const names = new Set(plugins.map(p => p.name))
        for (const p of plugins) {
            for (const d of deps(p)) {
                if (!names.has(d)) throw new Error(`Plugin "${p.name}" depends on "${d}", which this host doesn't have`)
            }
        }
        const all: GGPlugin<F>[] = []
        const remaining = [...plugins]
        while (remaining.length) {
            const i = remaining.findIndex(p => deps(p).every(d => all.some(o => o.name === d)))
            if (i < 0) throw new Error(`Plugin dependency cycle among: ${remaining.map(p => p.name).join(", ")}`)
            all.push(...remaining.splice(i, 1))
        }
        const on = new Set(all.filter(p => options.isOn?.(p.name) ?? true).map(p => p.name))
        const dropped: GGDroppedPlugin[] = []
        for (const p of all) {
            const missing = deps(p).find(d => !on.has(d))
            if (on.has(p.name) && missing !== undefined) {
                on.delete(p.name)
                dropped.push({name: p.name, missing})
            }
        }
        this.all = all
        this.active = all.filter(p => on.has(p.name))
        this.dropped = dropped
        this.configPrefix = options.configPrefix ?? (name => `plugins/${name}/`)
        for (const p of this.active) this.add(p.name, "provides", (p.facet as GGPluginFacet).provides ?? [])
    }

    /** Calls `facet[phase](ctx, config)` on every active plugin in order; entries it returns are provided, replacing
     *  what an earlier run of the phase provided (a runtime may compose again in the same process). */
    public async run<K extends PhaseOf<F>>(phase: K, ctx: PhaseCtx<F, K>): Promise<void> {
        for (const slot of this.provided.values()) slot.contributions = slot.contributions.filter(c => c.from !== phase)
        for (const p of this.active) {
            const fn = p.facet[phase] as AnyFn | undefined
            if (!fn) continue
            if ((p.facet as GGPluginFacet).config && !this.configs.has(p.name)) throw new Error(`Plugin "${p.name}" declares config, but configTree() wasn't called on this host`)
            const result = await fn.call(p.facet, ctx, this.configs.get(p.name))
            if (Array.isArray(result)) this.add(p.name, String(phase), result as GGPointEntry[])
        }
    }

    /** Every active plugin's config handles under its name (typed for every plugin: one that is off has none). Call it
     *  inside the app's `GGConfig.define`. */
    public configTree(): GGPluginConfigTree<P> {
        const tree: Record<string, unknown> = {}
        for (const p of this.active) {
            const facet = p.facet as GGPluginFacet
            if (!facet.config) continue
            const config = facet.config(this.configPrefix(p.name))
            this.configs.set(p.name, config)
            tree[p.name] = config
        }
        return tree as GGPluginConfigTree<P>
    }

    public localConfigTree(): Record<string, unknown> {
        const tree: Record<string, unknown> = {}
        for (const p of this.active) {
            const facet = p.facet as GGPluginFacet
            if (facet.localConfig) tree[p.name] = facet.localConfig()
        }
        return tree
    }

    /** The handles {@link configTree} built for `facet`. */
    public configOf<C>(facet: GGPluginFacet<C> & F): C {
        const p = this.active.find(a => a.facet === facet)
        if (!p || !this.configs.has(p.name)) throw new Error(`Plugin ${p ? `"${p.name}"` : "(not active here)"} built no config in this host`)
        return this.configs.get(p.name) as C
    }

    /** The item provided to `point`, or undefined while no active plugin provides it. */
    public one<T>(point: GGPoint<T, "one">): T | undefined {
        return this.many(point)[0]?.item
    }

    /** Every item provided to `point` by active plugins `isOn` accepts, in host order; items with a numeric `order`
     *  sort by it. `isOn` is a narrower scope (one workspace) and must already leave out plugins whose dependency is off.
     *  The returned contribution objects are stable for the host's lifetime. */
    public many<T>(point: GGPoint<T>, isOn?: (name: string) => boolean): GGContribution<T>[] {
        const contributions = (this.provided.get(point.id)?.contributions ?? []).map(e => e.c as GGContribution<T>)
        return contributions
            .filter(c => isOn?.(c.plugin) ?? true)
            .sort((a, b) => orderOf(a.item) - orderOf(b.item))
    }

    private add(plugin: string, from: string, entries: readonly GGPointEntry[]): void {
        for (const {point, items} of entries) {
            const slot = this.provided.get(point.id) ?? {point, contributions: []}
            if (slot.point.cardinality !== point.cardinality) throw new Error(`Point "${point.id}" is defined as both "one" and "many"`)
            slot.contributions.push(...items.map(item => ({from, c: {plugin, item}})))
            if (point.cardinality === "one" && slot.contributions.length > 1) {
                throw new Error(`Point "${point.id}" takes one item; ${slot.contributions.map(e => e.c.plugin).join(", ")} provide it`)
            }
            this.provided.set(point.id, slot)
        }
    }
}

function orderOf(item: unknown): number {
    const order = (item as {order?: unknown} | null)?.order
    return typeof order === "number" ? order : 0
}
