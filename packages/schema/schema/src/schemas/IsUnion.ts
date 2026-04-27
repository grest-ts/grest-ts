import {GGSchema, Opt} from "../GGSchema";
import {UnionDef} from "../Definition";
import type {GGSchemaNodeKind} from "../GGSchemaDescription";

/**
 * Extract the union of inferred types from a tuple of schemas.
 *
 * The naive `T[number] extends GGSchema<infer U> ? U : never` does NOT
 * distribute, because `T[number]` is an indexed access expression, not a
 * naked type parameter — TypeScript looks for a single `U` that satisfies
 * `GGSchema<U>` against the whole union, fails, and falls through to
 * `never`. The mapped-type pattern here checks each tuple index in
 * isolation (where `T[K]` IS a concrete single schema) and `[number]` at
 * the end unions the per-element inferences back together.
 */
type InferUnion<T extends GGSchema<any>[]> = {
    [K in keyof T]: T[K] extends GGSchema<infer U> ? U : never
}[number];

export class UnionSchema<T = unknown> extends GGSchema<T, UnionDef> {

    protected _buildDerived<NewT = T>(changes: Partial<UnionDef>): UnionSchema<NewT> {
        return new UnionSchema<NewT>({...this.def, ...changes});
    }

    get orUndefined(): UnionSchema<T | undefined> & Opt {
        return super.orUndefined as any
    }

    get orNull(): UnionSchema<T | null> {
        return super.orNull as any
    }

    protected _buildSchemaNode(): GGSchemaNodeKind {
        return {kind: 'union', variants: this.def.variants.map(v => v.toSchemaDescription())};
    }
}

export const IsUnion = <T extends GGSchema<any>[]>(...variants: T): UnionSchema<InferUnion<T>> => {
    if (variants.length < 2) {
        throw new Error("IsUnion requires at least two variants");
    }
    const hasNonJsonData = variants.some(v => v.toCompilerDef().hasNonJsonData);
    return new UnionSchema<InferUnion<T>>({type: 'union', variants, hasNonJsonData});
}
