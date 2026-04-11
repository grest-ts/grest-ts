import {GGSchema, Opt} from "../GGSchema";
import {AnyDef} from "../Definition";
import type {OpenAPIV3_1} from "openapi-types";

export class AnySchema<T = any> extends GGSchema<T, AnyDef> {

    protected derive<NewT = T>(changes: Partial<AnyDef>): AnySchema<NewT> {
        return new AnySchema<NewT>({...this.def, ...changes});
    }

    get orUndefined(): AnySchema<T | undefined> & Opt {
        return super.orUndefined as any
    }

    get orNull(): AnySchema<T | null> {
        return super.orNull as any
    }

    toJSONSchema(): OpenAPIV3_1.SchemaObject {
        return {};
    }
}

export const IsAny = new AnySchema({type: 'any'});
