import {GGSchema, Opt} from "../GGSchema";
import {LiteralDef, LiteralValue} from "../Definition";
import type {OpenAPIV3_1} from "openapi-types";

export class LiteralSchema<T extends LiteralValue | undefined | null = LiteralValue> extends GGSchema<T, LiteralDef> {

    constructor(def: LiteralDef) {
        super(def);
        if (def.values.length === 0) {
            throw new Error("LiteralSchema requires at least one value");
        }
        for (const v of def.values) {
            if (typeof v === 'number' && !Number.isFinite(v)) {
                throw new Error(`LiteralSchema does not accept ${v} - only finite numbers are allowed`);
            }
        }
    }

    get orUndefined(): LiteralSchema<T | undefined> & Opt {
        return super.orUndefined as any
    }

    get orNull(): LiteralSchema<T | null> {
        return super.orNull as any
    }

    protected derive<NewT extends LiteralValue | undefined | null = T>(changes: Partial<LiteralDef>): LiteralSchema<NewT> {
        return new LiteralSchema<NewT>({...this.def, ...changes});
    }

    toJSONSchema(): OpenAPIV3_1.SchemaObject {
        const schema: OpenAPIV3_1.SchemaObject = {enum: [...this.def.values]};
        if (this.def.nullable) return {oneOf: [schema, {type: 'null'}]};
        return schema;
    }
}

export const IsLiteral = <T extends LiteralValue[]>(...values: T): LiteralSchema<T[number]> => {
    return new LiteralSchema<T[number]>({type: 'literal', values});
}
