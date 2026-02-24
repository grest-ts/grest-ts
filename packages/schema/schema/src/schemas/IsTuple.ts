import {GGSchema, Opt} from "../GGSchema";
import {TupleDef} from "../Definition";

type InferTuple<T extends readonly GGSchema<any>[]> = {
    -readonly [K in keyof T]: T[K] extends GGSchema<infer U> ? U : never
};

export interface TupleDefImpl extends TupleDef {
    readonly elementsFactory?: () => readonly GGSchema<any>[];
}

export class TupleSchema<T extends readonly unknown[] = readonly unknown[]> extends GGSchema<T, TupleDefImpl> {

    constructor(def: TupleDefImpl) {
        super(def);
        if (!def.elements && !def.elementsFactory) {
            throw new Error("TupleSchema must be created with element types via IsTuple()");
        }
    }

    protected derive<NewT extends readonly unknown[] | undefined | null = T>(changes: Partial<TupleDefImpl>): TupleSchema<NewT> {
        return new TupleSchema<NewT>({...this.def, ...changes});
    }

    get orUndefined(): TupleSchema<T | undefined> & Opt {
        return super.orUndefined as any
    }

    get orNull(): TupleSchema<T | null> {
        return super.orNull as any
    }

    protected _toCompilerDef(): TupleDefImpl {
        let elements: readonly GGSchema<any>[];
        if (this.def.elementsFactory) {
            elements = this.def.elementsFactory();
        } else if (this.def.elements) {
            elements = this.def.elements;
        } else {
            throw new Error("TupleSchema must be created with element types via IsTuple()");
        }

        if (elements.length === 0) {
            throw new Error("IsTuple requires at least one element schema");
        }

        const hasNonJsonData = elements.some(e => e.toCompilerDef().hasNonJsonData);
        return {...this.def, elements, hasNonJsonData};
    }

}

export function IsTuple<T extends readonly GGSchema<any>[]>(...args: T | [() => T]): TupleSchema<InferTuple<T>> {
    if (args.length === 1 && typeof args[0] === 'function') {
        return new TupleSchema<InferTuple<T>>({type: 'tuple', elementsFactory: args[0] as () => T});
    } else {
        return new TupleSchema<InferTuple<T>>({type: 'tuple', elements: args as T});
    }
}
