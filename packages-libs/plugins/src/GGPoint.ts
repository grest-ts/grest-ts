export type GGPointCardinality = "one" | "many"

export interface GGPointEntry {
    readonly point: GGPoint<unknown>
    readonly items: readonly unknown[]
}

export interface GGPointOptions {
    /** The plugin that hosts the point: while it is off, nothing reaches it. */
    owner?: string
}

/**
 * A typed extension point. Plugins fill it with `provide(...)` entries; the host reads it with `one` / `many`.
 * Points are matched by `key` (owner and id), not by object, so two copies of the module defining one still meet.
 */
export class GGPoint<T, C extends GGPointCardinality = GGPointCardinality> {

    public readonly id: string
    public readonly cardinality: C
    public readonly owner: string | undefined
    /** `<owner>/<id>`, or `id` for an app point. */
    public readonly key: string

    private constructor(id: string, cardinality: C, options: GGPointOptions) {
        this.id = id
        this.cardinality = cardinality
        this.owner = options.owner
        this.key = options.owner === undefined ? id : `${options.owner}/${id}`
    }

    /** At most one plugin provides it. */
    public static one<T>(id: string, options: GGPointOptions = {}): GGPoint<T, "one"> {
        return new GGPoint<T, "one">(id, "one", options)
    }

    /** Any number of plugins provide items, in host order. */
    public static many<T>(id: string, options: GGPointOptions = {}): GGPoint<T, "many"> {
        return new GGPoint<T, "many">(id, "many", options)
    }

    public provide(...items: C extends "one" ? [item: T] : T[]): GGPointEntry {
        return {point: this as GGPoint<unknown>, items}
    }
}

export interface GGContribution<T> {
    readonly plugin: string
    readonly item: T
}
