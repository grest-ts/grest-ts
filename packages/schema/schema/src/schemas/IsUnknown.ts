import {GGSchema, Opt} from "../GGSchema";
import {UnknownDef} from "../Definition";
import type {GGSchemaNodeKind} from "../GGSchemaDescription";

export class UnknownSchema<T = unknown> extends GGSchema<T, UnknownDef> {

    protected _buildDerived<NewT = T>(changes: Partial<UnknownDef>): UnknownSchema<NewT> {
        return new UnknownSchema<NewT>({...this.def, ...changes});
    }

    get orUndefined(): UnknownSchema<T | undefined> & Opt {
        return super.orUndefined as any
    }

    get orNull(): UnknownSchema<T | null> {
        return super.orNull as any
    }

    protected _buildSchemaNode(): GGSchemaNodeKind {
        return {kind: 'unknown'};
    }
}

export const IsUnknown = new UnknownSchema({type: 'unknown'});
