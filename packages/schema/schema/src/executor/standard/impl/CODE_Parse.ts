import {GGIssuesList} from "../../../issue/GGIssuesList";
import {GGIssueKey} from "../../../issue/GGIssueKey";
import type {AnyStandardSchemaDef} from "../../../Definition";
import {CODE_Clean} from "./CODE_Clean";
import {CODE_Validate} from "./CODE_Validate";

/**
 * ParseInterpreter - handles the full parse flow:
 * 1. defaultValue handling for undefined
 * 2. optional/nullable checks
 * 3. Cleaning (with optional coercion)
 * 4. Validation with error collection
 */
export class CODE_Parse {
    private static _instance: CODE_Parse;

    static get instance(): CODE_Parse {
        return this._instance ??= new CODE_Parse();
    }

    /**
     * Parse a value according to its schema definition.
     * Returns the cleaned value if valid, undefined if invalid.
     */
    parse(def: AnyStandardSchemaDef, value: unknown, issues: GGIssuesList, path: string, coerce?: boolean): unknown {
        // Handle default before anything else (null/undefined → default value), only when coercing
        if (coerce && value == null && def.defaultValue !== undefined) {
            return def.defaultValue;
        }
        // Handle undefined
        if (value === undefined) {
            if (def.optional) return undefined;
            GGIssueKey.required.add(value, issues, path);
            return undefined;
        }
        // Handle null
        if (value === null) {
            if (def.nullable) return null;
            GGIssueKey.required.add(value, issues, path);
            return undefined;
        }
        // Clean the value (with optional coercion)
        value = CODE_Clean.instance.clean(def, value, coerce);
        // Validate type + refinements (ValidateInterpreter handles it all)
        // Note: value is not undefined/null here, so the undefined/null checks in validate are no-ops
        if (!CODE_Validate.instance.validate(def, value, issues, path)) return undefined;
        return value;
    }
}
