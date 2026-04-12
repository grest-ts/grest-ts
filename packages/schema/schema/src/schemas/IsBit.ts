import {GGSchema, Opt} from "../GGSchema";
import {BitDef} from "../Definition";
import type {GGSchemaNodeKind} from "../GGSchemaDescription";

export class BitSchema<T extends 0 | 1 | undefined | null = 0 | 1> extends GGSchema<T, BitDef> {

    protected _buildDerived<NewT extends 0 | 1 | undefined | null = T>(changes: Partial<BitDef>): BitSchema<NewT> {
        return new BitSchema<NewT>({...this.def, ...changes});
    }

    get orUndefined(): BitSchema<T | undefined> & Opt {
        return super.orUndefined as any
    }

    get orNull(): BitSchema<T | null> {
        return super.orNull as any
    }

    protected _buildSchemaNode(): GGSchemaNodeKind {
        return {kind: 'bit'};
    }
}

export const IsBit: BitSchema<0 | 1> = new BitSchema({type: 'bit'});
