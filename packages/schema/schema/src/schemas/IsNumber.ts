import {GGSchema, Opt} from "../GGSchema";
import {NumberDef} from "../Definition";

export class NumberSchema<T extends Number | number | undefined | null = number> extends GGSchema<T, NumberDef> {

    get orUndefined(): NumberSchema<T | undefined> & Opt {
        return super.orUndefined as any
    }

    get orNull(): NumberSchema<T | null> {
        return super.orNull as any
    }

    // --------------------------------------------------------------------------------------

    min(n: number): NumberSchema<T> {
        return this.derive({min: n});
    }

    max(n: number): NumberSchema<T> {
        return this.derive({max: n});
    }

    range(min: number, max: number): NumberSchema<T> {
        return this.derive({min, max});
    }

    multipleOf(n: number): NumberSchema<T> {
        if (n <= 0) throw new Error(`multipleOf must be positive, got ${n}`);
        return this.derive({multipleOf: n});
    }

    protected derive<NewT extends Number | number | undefined | null = T>(changes: Partial<NumberDef>): NumberSchema<NewT> {
        const newDef: NumberDef = {...this.def, ...changes};

        if (this.def.min !== undefined && newDef.min !== undefined && newDef.min < this.def.min) {
            throw new Error(`Cannot lower min from ${this.def.min} to ${newDef.min}`);
        }
        if (this.def.max !== undefined && newDef.max !== undefined && newDef.max > this.def.max) {
            throw new Error(`Cannot raise max from ${this.def.max} to ${newDef.max}`);
        }
        if (this.def.integer && newDef.integer === false) {
            throw new Error(`Cannot remove integer constraint`);
        }
        if (newDef.min !== undefined && newDef.max !== undefined && newDef.min > newDef.max) {
            throw new Error(`Invalid range: min ${newDef.min} > max ${newDef.max}`);
        }

        return new NumberSchema<NewT>(newDef);
    }

    // --------------------------------------------------------------------------------------

    toJSONSchema(): object {
        const schema: Record<string, unknown> = this.def.integer ? {type: 'integer'} : {type: 'number'};
        if (this.def.min !== undefined) schema.minimum = this.def.min;
        if (this.def.max !== undefined) schema.maximum = this.def.max;
        if (this.def.multipleOf !== undefined) schema.multipleOf = this.def.multipleOf;
        if (this.def.nullable) return {anyOf: [schema, {type: 'null'}]};
        return schema;
    }
}


export const IsNumber = new NumberSchema({type: 'number'});
