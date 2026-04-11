import {GGSchema, Opt} from "../GGSchema";
import {UnionDef} from "../Definition";
import type {OpenAPIV3_1} from "openapi-types";

type InferUnion<T extends GGSchema<any>[]> = T[number] extends GGSchema<infer U> ? U : never;

export class UnionSchema<T = unknown> extends GGSchema<T, UnionDef> {

    protected derive<NewT = T>(changes: Partial<UnionDef>): UnionSchema<NewT> {
        return new UnionSchema<NewT>({...this.def, ...changes});
    }

    get orUndefined(): UnionSchema<T | undefined> & Opt {
        return super.orUndefined as any
    }

    get orNull(): UnionSchema<T | null> {
        return super.orNull as any
    }

    toJSONSchema(): OpenAPIV3_1.SchemaObject {
        const variants = this.def.variants.map(v => v.toJSONSchema());
        const schema: OpenAPIV3_1.SchemaObject = {oneOf: variants};
        if (this.def.nullable) return {oneOf: [schema, {type: 'null'}]};
        return schema;
    }
}

export const IsUnion = <T extends GGSchema<any>[]>(...variants: T): UnionSchema<InferUnion<T>> => {
    if (variants.length < 2) {
        throw new Error("IsUnion requires at least two variants");
    }
    const hasNonJsonData = variants.some(v => v.toCompilerDef().hasNonJsonData);
    return new UnionSchema<InferUnion<T>>({type: 'union', variants, hasNonJsonData});
}
