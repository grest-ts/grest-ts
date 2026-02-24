import {GGSchema, Opt} from "../GGSchema";
import {ArrayDef} from "../Definition";

export class ArraySchema<T extends any[] = any[]> extends GGSchema<T, ArrayDef> {

    constructor(def: ArrayDef) {
        super(def);
        if (!def.element && !def.elementFactory) {
            throw new Error("ArraySchema must be created with an element type via IsArray()");
        }
    }

    get orUndefined(): ArraySchema<T | undefined> & Opt {
        return super.orUndefined as any
    }

    get orNull(): ArraySchema<T | null> {
        return super.orNull as any
    }

    minLength(n: number): ArraySchema<T> {
        return this.derive({minLength: n});
    }

    maxLength(n: number): ArraySchema<T> {
        return this.derive({maxLength: n});
    }

    range(min: number, max: number): ArraySchema<T> {
        return this.derive({minLength: min, maxLength: max});
    }

    protected derive<NewT extends T | undefined | null = T>(changes: Partial<ArrayDef>): ArraySchema<NewT> {
        const newDef: ArrayDef = {...this.def, ...changes};
        if (this.def.minLength !== undefined && newDef.minLength !== undefined && newDef.minLength < this.def.minLength) {
            throw new Error(`Cannot lower minLength from ${this.def.minLength} to ${newDef.minLength}`);
        }
        if (this.def.maxLength !== undefined && newDef.maxLength !== undefined && newDef.maxLength > this.def.maxLength) {
            throw new Error(`Cannot raise maxLength from ${this.def.maxLength} to ${newDef.maxLength}`);
        }
        if (newDef.minLength !== undefined && newDef.maxLength !== undefined && newDef.minLength > newDef.maxLength) {
            throw new Error(`Invalid range: minLength ${newDef.minLength} > maxLength ${newDef.maxLength}`);
        }
        return new ArraySchema<NewT>(newDef);
    }

    // --------------------------------------------------------------------------------------

    toJSONSchema(): object {
        const def = this.toCompilerDef();
        const schema: Record<string, unknown> = {type: 'array'};
        schema.items = def.element!.toJSONSchema();
        if (def.minLength !== undefined) schema.minItems = def.minLength;
        if (def.maxLength !== undefined) schema.maxItems = def.maxLength;
        if (def.nullable) return {anyOf: [schema, {type: 'null'}]};
        return schema;
    }

    protected _toCompilerDef(): ArrayDef {
        const element = this.def.elementFactory ? this.def.elementFactory() : this.def.element;
        if (!element) throw new Error("ArraySchema must be created with an element type via IsArray()");
        return {...this.def, element, hasNonJsonData: element.toCompilerDef().hasNonJsonData};
    }
}

// Cache for non-factory array schemas
const arrayCache = new WeakMap<GGSchema<any>, ArraySchema<any[]>>();

// Factory function for creating ArraySchema instances
export const IsArray = <E>(element: GGSchema<E> | (() => GGSchema<E>)): ArraySchema<E[]> => {
    if (typeof element === 'function') {
        return new ArraySchema<E[]>({type: 'array', elementFactory: element as () => GGSchema<any>});
    }
    let cached = arrayCache.get(element);
    if (!cached) {
        cached = new ArraySchema<E[]>({type: 'array', element});
        arrayCache.set(element, cached);
    }
    return cached as ArraySchema<E[]>;
};
