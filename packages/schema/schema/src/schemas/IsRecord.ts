import {GGSchema, Opt} from "../GGSchema";
import {RecordDef} from "../Definition";
import type {OpenAPIV3_1} from "openapi-types";

export class RecordSchema<T extends Record<string, unknown> | undefined | null = Record<string, unknown>> extends GGSchema<T, RecordDef> {

    protected derive<NewT extends Record<string, unknown> | undefined | null = T>(changes: Partial<RecordDef>): RecordSchema<NewT> {
        return new RecordSchema<NewT>({...this.def, ...changes});
    }

    get orUndefined(): RecordSchema<T | undefined> & Opt {
        return super.orUndefined as any
    }

    get orNull(): RecordSchema<T | null> {
        return super.orNull as any
    }

    protected _buildJsonSchema(): OpenAPIV3_1.SchemaObject {
        return {
            type: 'object',
            additionalProperties: this.def.value.toJSONSchema()
        };
    }
}

export const IsRecord = <K extends string, V>(
    keySchema: GGSchema<K>,
    valueSchema: GGSchema<V>
): RecordSchema<Record<K, V>> => {
    return new RecordSchema<Record<K, V>>({
        type: 'record',
        key: keySchema as GGSchema<string>,
        value: valueSchema,
        hasNonJsonData: valueSchema.toCompilerDef().hasNonJsonData
    });
};

/**
 * Like IsRecord, but produces Partial<Record<K, V>> instead of Record<K, V>.
 * Runtime validation is identical - only present keys are validated.
 * The difference is purely at the TypeScript type level: keys are optional.
 */
export const IsPartialRecord = <K extends string, V>(
    keySchema: GGSchema<K>,
    valueSchema: GGSchema<V>
): RecordSchema<Partial<Record<K, V>>> => {
    return new RecordSchema<Partial<Record<K, V>>>({
        type: 'record',
        key: keySchema as GGSchema<string>,
        value: valueSchema,
        hasNonJsonData: valueSchema.toCompilerDef().hasNonJsonData
    });
};
