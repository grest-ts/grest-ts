import {GGSchema} from "../../../GGSchema";
import {GGIssuesList} from "../../../issue/GGIssuesList";
import type {AnyStandardSchemaDef} from "../../../Definition";
import {AOT_Is} from "./AOT_Is";
import {AOT_Clean} from "./AOT_Clean";
import {AOT_Validate} from "./AOT_Validate";
import {AOT_Coerce} from "./AOT_Coerce";

export type ParseFn<T> = (value: unknown, issues: GGIssuesList, path: string, coerce?: boolean) => T | undefined;

/**
 * ParseCompiler - compiles a parse function with fast-path optimization.
 *
 * Fast path: if value passes `is` check, just clean and return.
 * Slow path: use compiled validate for fast error collection, then clean if valid.
 * Coercion path: apply coercion first, then same logic.
 */
export class AOT_Parse {
    compile<T>(schema: GGSchema<T>): ParseFn<T> {
        const isCheck = new AOT_Is().compile(schema);
        const clean = new AOT_Clean().compile(schema);
        const validate = new AOT_Validate().compile(schema);
        const coerceClean = new AOT_Coerce().compile(schema);

        // Extract default handling - these need to happen before is/validate
        const def = schema.toCompilerDef() as AnyStandardSchemaDef;
        const defaultValue = def.defaultValue;
        const hasDefault = defaultValue !== undefined;

        return function (value: unknown, issues: GGIssuesList, path: string, coerce?: boolean): T | undefined {
            // Handle default before anything else (null/undefined → default value), only when coercing
            if (coerce && value == null && hasDefault) {
                return defaultValue as T;
            }
            // Apply coercion if requested
            if (coerce) {
                value = coerceClean(value);
            }
            // Clean first (applies field defaults, strips unknown props)
            // This matches CODE_Parse which cleans before validate
            value = clean(value);
            // Fast path: value already valid (and already cleaned)
            if (isCheck(value)) {
                return value as T;
            }
            // Slow path: validate for error collection (on already-cleaned value)
            if (validate(value, issues, path)) {
                return value as T;
            }
            return undefined;
        };
    }
}
