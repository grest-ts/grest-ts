export type GGPointCardinality = "one" | "many"

export interface GGPointEntry {
    readonly point: GGPoint<unknown>
    readonly items: readonly unknown[]
}

/**
 * A typed extension point. Plugins fill it with `provide(...)` entries; the host reads it with `one` / `many`.
 * Points are matched by `id`, not by object, so two copies of the module defining one still meet: prefix the id of a
 * plugin's own point with its name (`"approvals.grantTypes"`).
 */
export class GGPoint<T, C extends GGPointCardinality = GGPointCardinality> {

    public readonly id: string
    public readonly cardinality: C

    private constructor(id: string, cardinality: C) {
        this.id = id
        this.cardinality = cardinality
    }

    /** At most one plugin provides it. */
    public static one<T>(id: string): GGPoint<T, "one"> {
        return new GGPoint<T, "one">(id, "one")
    }

    /** Any number of plugins provide items, in host order; items with a numeric `order` field are sorted by it. */
    public static many<T>(id: string): GGPoint<T, "many"> {
        return new GGPoint<T, "many">(id, "many")
    }

    public provide(...items: C extends "one" ? [item: T] : T[]): GGPointEntry {
        return {point: this as GGPoint<unknown>, items}
    }
}

export interface GGContribution<T> {
    readonly plugin: string
    readonly item: T
}
