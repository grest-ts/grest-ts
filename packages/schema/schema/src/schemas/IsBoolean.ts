import {GGSchema, Opt} from "../GGSchema";
import {BooleanDef} from "../Definition";

export class BooleanSchema<T extends boolean | undefined | null = boolean> extends GGSchema<T, BooleanDef> {

    get orUndefined(): BooleanSchema<T | undefined> & Opt {
        return super.orUndefined as any
    }

    get orNull(): BooleanSchema<T | null> {
        return super.orNull as any
    }

    // --------------------------------------------------------------------------------------

    protected derive<NewT extends boolean | undefined | null = T>(changes: Partial<BooleanDef>): BooleanSchema<NewT> {
        return new BooleanSchema<NewT>({...this.def, ...changes});
    }

    // --------------------------------------------------------------------------------------

    toJSONSchema(): object {
        const schema = {type: 'boolean'};
        if (this.def.nullable) return {anyOf: [schema, {type: 'null'}]};
        return schema;
    }
}

export const IsBoolean = new BooleanSchema({type: 'boolean'});
