import {GGIssueInvalid} from "../issue/issues/GGIssueInvalid";
import {GGSchema, Opt} from "../GGSchema";
import {StringDef} from "../Definition";
import type {OpenAPIV3_1} from "openapi-types";

export class StringSchema<T extends string | undefined | null = string> extends GGSchema<T, StringDef> {

    get orUndefined(): StringSchema<T | undefined> & Opt {
        return super.orUndefined as any
    }

    get orNull(): StringSchema<T | null> {
        return super.orNull as any
    }

    // --------------------------------------------------------------------------------------

    get nonEmpty(): StringSchema<T> {
        return this.derive({nonEmpty: true});
    }

    get trim(): StringSchema<T> {
        return this.derive({trim: true});
    }

    minLength(n: number): StringSchema<T> {
        return this.derive({minLength: n});
    }

    maxLength(n: number): StringSchema<T> {
        return this.derive({maxLength: n});
    }

    range(min: number, max: number): StringSchema<T> {
        return this.derive({minLength: min, maxLength: max});
    }

    regex(pattern: RegExp, error?: GGIssueInvalid): StringSchema<T> {
        // Strip global flag to prevent lastIndex state issues on repeated calls
        const safePattern = pattern.global
            ? new RegExp(pattern.source, pattern.flags.replace('g', ''))
            : pattern;

        if (error) {
            // Don't store pattern in def when custom error provided - only use refinement
            return this.refine(v => safePattern.test(v), error) as unknown as StringSchema<T>;
        }
        return this.derive({pattern: safePattern});
    }

    protected derive<NewT extends string | undefined | null = T>(changes: Partial<StringDef>): StringSchema<NewT> {
        const newDef: StringDef = {...this.def, ...changes};

        if (this.def.minLength !== undefined && newDef.minLength !== undefined && newDef.minLength < this.def.minLength) {
            throw new Error(`Cannot lower minLength from ${this.def.minLength} to ${newDef.minLength}`);
        }
        if (this.def.maxLength !== undefined && newDef.maxLength !== undefined && newDef.maxLength > this.def.maxLength) {
            throw new Error(`Cannot raise maxLength from ${this.def.maxLength} to ${newDef.maxLength}`);
        }
        if (this.def.nonEmpty && newDef.nonEmpty === false) {
            throw new Error(`Cannot remove nonEmpty constraint`);
        }
        if (this.def.trim && newDef.trim === false) {
            throw new Error(`Cannot remove trim constraint`);
        }
        if (newDef.minLength !== undefined && newDef.maxLength !== undefined && newDef.minLength > newDef.maxLength) {
            throw new Error(`Invalid range: minLength ${newDef.minLength} > maxLength ${newDef.maxLength}`);
        }

        return new StringSchema<NewT>(newDef);
    }

    // --------------------------------------------------------------------------------------

    protected _buildJsonSchema(): OpenAPIV3_1.SchemaObject {
        const schema: OpenAPIV3_1.NonArraySchemaObject = {type: 'string'};
        const minLength = this.def.nonEmpty && this.def.minLength === undefined ? 1 : this.def.minLength;
        if (minLength !== undefined) schema.minLength = minLength;
        if (this.def.maxLength !== undefined) schema.maxLength = this.def.maxLength;
        if (this.def.pattern) schema.pattern = this.def.pattern.source;
        return schema;
    }
}

export const IsString = new StringSchema({type: 'string'});
