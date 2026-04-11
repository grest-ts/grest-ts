import {GGSchema, Opt} from "../GGSchema";
import {UnknownDef} from "../Definition";
import type {OpenAPIV3_1} from "openapi-types";

export class UnknownSchema<T = unknown> extends GGSchema<T, UnknownDef> {

    protected derive<NewT = T>(changes: Partial<UnknownDef>): UnknownSchema<NewT> {
        return new UnknownSchema<NewT>({...this.def, ...changes});
    }

    get orUndefined(): UnknownSchema<T | undefined> & Opt {
        return super.orUndefined as any
    }

    get orNull(): UnknownSchema<T | null> {
        return super.orNull as any
    }

    toJSONSchema(): OpenAPIV3_1.SchemaObject {
        return {};
    }
}

export const IsUnknown = new UnknownSchema({type: 'unknown'});
