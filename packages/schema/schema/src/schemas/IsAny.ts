import {GGSchema, Opt} from "../GGSchema";
import {AnyDef} from "../Definition";
import type {GGSchemaNodeKind} from "../GGSchemaDescription";

export class AnySchema<T = any> extends GGSchema<T, AnyDef> {

    protected _buildDerived<NewT = T>(changes: Partial<AnyDef>): AnySchema<NewT> {
        return new AnySchema<NewT>({...this.def, ...changes});
    }

    get orUndefined(): AnySchema<T | undefined> & Opt {
        return super.orUndefined as any
    }

    get orNull(): AnySchema<T | null> {
        return super.orNull as any
    }

    protected _buildSchemaNode(): GGSchemaNodeKind {
        return {kind: 'any'};
    }
}

export const IsAny = new AnySchema({type: 'any'});
