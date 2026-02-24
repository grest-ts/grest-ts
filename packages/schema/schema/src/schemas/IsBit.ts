import {GGSchema, Opt} from "../GGSchema";
import {BitDef} from "../Definition";

export class BitSchema<T extends 0 | 1 | undefined | null = 0 | 1> extends GGSchema<T, BitDef> {

    protected derive<NewT extends 0 | 1 | undefined | null = T>(changes: Partial<BitDef>): BitSchema<NewT> {
        return new BitSchema<NewT>({...this.def, ...changes});
    }

    get orUndefined(): BitSchema<T | undefined> & Opt {
        return super.orUndefined as any
    }

    get orNull(): BitSchema<T | null> {
        return super.orNull as any
    }
}

export const IsBit: BitSchema<0 | 1> = new BitSchema({type: 'bit'});
