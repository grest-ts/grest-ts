import {GGSchema, Opt} from "../GGSchema";
import {BooleanDef} from "../Definition";
import type {GGSchemaNodeKind} from "../GGSchemaDescription";

export class BooleanSchema<T extends boolean | undefined | null = boolean> extends GGSchema<T, BooleanDef> {

    get orUndefined(): BooleanSchema<T | undefined> & Opt {
        return super.orUndefined as any
    }

    get orNull(): BooleanSchema<T | null> {
        return super.orNull as any
    }

    // --------------------------------------------------------------------------------------

    protected _buildDerived<NewT extends boolean | undefined | null = T>(changes: Partial<BooleanDef>): BooleanSchema<NewT> {
        return new BooleanSchema<NewT>({...this.def, ...changes});
    }

    // --------------------------------------------------------------------------------------

    protected _buildSchemaNode(): GGSchemaNodeKind {
        return {kind: 'boolean'};
    }
}

export const IsBoolean = new BooleanSchema({type: 'boolean'});
