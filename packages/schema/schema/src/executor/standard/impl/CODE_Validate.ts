import {GGIssuesList} from "../../../issue/GGIssuesList";
import {GGIssueKey} from "../../../issue/GGIssueKey";
import type {ArrayDef, DiscriminatedDef, GGSchemaDefinition, LiteralDef, NumberDef, ObjectDef, RecordDef, AnyStandardSchemaDef, StringDef, TupleDef, UnionDef} from "../../../Definition";
import {isMultipleOf} from "./CODE_Is";
import {
    IsArrayErrors,
    IsBitErrors,
    IsBooleanErrors,
    IsDiscriminatedErrors,
    IsLiteralErrors,
    IsNumberErrors,
    IsObjectErrors,
    IsRecordErrors,
    IsStringErrors,
    IsTupleErrors,
    IsUnionErrors
} from "../../../Errors";

/**
 * ValidateInterpreter - handles validation with error collection.
 *
 * This is the "slow path" that collects detailed error information.
 * Used when validation fails or when errors are needed.
 */
export class CODE_Validate {
    private static _instance: CODE_Validate;

    static get instance(): CODE_Validate {
        return this._instance ??= new CODE_Validate();
    }

    /**
     * Validate a value according to its schema definition.
     * Handles undefined/null, type-specific checks, and refinements.
     * Adds issues to the issues list and returns whether validation passed.
     */
    validate(def: AnyStandardSchemaDef, value: unknown, issues: GGIssuesList, path: string): boolean {
        // Handle undefined
        if (value === undefined) {
            if (def.optional) return true;
            GGIssueKey.required.add(value, issues, path);
            return false;
        }
        // Handle null
        if (value === null) {
            if (def.nullable) return true;
            GGIssueKey.required.add(value, issues, path);
            return false;
        }
        // Type-specific check
        if (!this.validateType(def, value, issues, path)) return false;
        // Refinements
        if (def.refinements) {
            for (const r of def.refinements) {
                if (!r.check(value)) {
                    r.error.add(value, issues, path);
                    return false;
                }
            }
        }
        return true;
    }

    private validateType(def: AnyStandardSchemaDef, value: unknown, issues: GGIssuesList, path: string): boolean {
        switch (def.type) {
            case 'string':
                return this.validateString(def, value, issues, path);
            case 'number':
            case 'int':
            case 'uint':
            case 'posInt':
            case 'int8':
            case 'int16':
            case 'int32':
            case 'uint8':
            case 'uint16':
            case 'uint32':
                return this.validateNumber(def, value, issues, path);
            case 'boolean':
                return this.validateBoolean(def, value, issues, path);
            case 'bit':
                return this.validateBit(def, value, issues, path);
            case 'literal':
                return this.validateLiteral(def, value, issues, path);
            case 'object':
                return this.validateObject(def, value, issues, path);
            case 'array':
                return this.validateArray(def, value, issues, path);
            case 'tuple':
                return this.validateTuple(def, value, issues, path);
            case 'record':
                return this.validateRecord(def, value, issues, path);
            case 'union':
                return this.validateUnion(def, value, issues, path);
            case 'discriminated':
                return this.validateDiscriminated(def, value, issues, path);
            case 'any':
            case 'unknown':
                return true;
            default: {
                const baseDef = def as GGSchemaDefinition;
                if (baseDef.isWithErrors) {
                    return baseDef.isWithErrors(value, issues, path);
                }
                throw new Error(`Custom schema type "${(def as GGSchemaDefinition).type}" must implement isWithErrors for validation to work correctly.`);
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Primitives
    // ──────────────────────────────────────────────────────────────────────────

    private validateString(def: StringDef, value: unknown, issues: GGIssuesList, path: string): boolean {
        if (typeof value !== 'string') {
            return IsStringErrors.typeError.add(value, issues, path);
        }

        const startLength = issues.length;

        if (def.nonEmpty && value.length === 0) {
            IsStringErrors.nonEmptyError.add(value, issues, path);
        }

        if (def.minLength !== undefined && def.maxLength !== undefined) {
            if (value.length < def.minLength || value.length > def.maxLength) {
                IsStringErrors.rangeError.add(value, issues, path, {min: def.minLength, max: def.maxLength});
            }
        } else {
            if (def.minLength !== undefined && value.length < def.minLength) {
                IsStringErrors.minLengthError.add(value, issues, path, {min: def.minLength});
            }
            if (def.maxLength !== undefined && value.length > def.maxLength) {
                IsStringErrors.maxLengthError.add(value, issues, path, {max: def.maxLength});
            }
        }

        if (def.pattern && !def.pattern.test(value)) {
            IsStringErrors.patternError.add(value, issues, path);
        }

        return issues.length === startLength;
    }

    private validateNumber(def: NumberDef, value: unknown, issues: GGIssuesList, path: string): boolean {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return IsNumberErrors.typeError.add(value, issues, path);
        }

        const startLength = issues.length;

        if (def.integer && !Number.isInteger(value)) {
            IsNumberErrors.integerError.add(value, issues, path);
        }

        if (def.min !== undefined && def.max !== undefined) {
            if (value < def.min || value > def.max) {
                IsNumberErrors.rangeError.add(value, issues, path, {min: def.min, max: def.max});
            }
        } else {
            if (def.min !== undefined && value < def.min) {
                IsNumberErrors.minError.add(value, issues, path, {min: def.min});
            }
            if (def.max !== undefined && value > def.max) {
                IsNumberErrors.maxError.add(value, issues, path, {max: def.max});
            }
        }

        if (def.multipleOf !== undefined && !isMultipleOf(value, def.multipleOf)) {
            IsNumberErrors.multipleOfError.add(value, issues, path, {multipleOf: def.multipleOf});
        }

        return issues.length === startLength;
    }

    private validateBoolean(_def: AnyStandardSchemaDef, value: unknown, issues: GGIssuesList, path: string): boolean {
        if (typeof value === 'boolean') return true;
        return IsBooleanErrors.typeError.add(value, issues, path);
    }

    private validateBit(_def: AnyStandardSchemaDef, value: unknown, issues: GGIssuesList, path: string): boolean {
        if (value === 0 || value === 1) return true;
        return IsBitErrors.typeError.add(value, issues, path);
    }

    private validateLiteral(def: LiteralDef, value: unknown, issues: GGIssuesList, path: string): boolean {
        const values = def.values;
        for (const val of values) {
            if (value === val) return true;
        }
        return IsLiteralErrors.invalidError.add(value, issues, path, {expected: values.join(', ')});
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Structural
    // ──────────────────────────────────────────────────────────────────────────

    private validateObject(def: ObjectDef, value: unknown, issues: GGIssuesList, path: string): boolean {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return IsObjectErrors.typeError.add(value, issues, path);
        }

        const startLength = issues.length;
        const shape = def.shape!;
        const prefix = path ? path + '.' : '';

        for (const k in shape) {
            const fieldSchema = shape[k];
            if (fieldSchema && typeof fieldSchema === 'object' && 'toCompilerDef' in fieldSchema) {
                this.validate(fieldSchema.toCompilerDef() as AnyStandardSchemaDef, (value as any)[k], issues, prefix + k);
            }
        }

        return issues.length === startLength;
    }

    private validateArray(def: ArrayDef, value: unknown, issues: GGIssuesList, path: string): boolean {

        if (!Array.isArray(value)) {
            return IsArrayErrors.typeError.add(value, issues, path);
        }

        const startLength = issues.length;

        if (def.minLength !== undefined && def.maxLength !== undefined) {
            if (value.length < def.minLength || value.length > def.maxLength) {
                IsArrayErrors.rangeError.add(value, issues, path, {min: def.minLength, max: def.maxLength});
            }
        } else {
            if (def.minLength !== undefined && value.length < def.minLength) {
                IsArrayErrors.minLengthError.add(value, issues, path, {min: def.minLength});
            }
            if (def.maxLength !== undefined && value.length > def.maxLength) {
                IsArrayErrors.maxLengthError.add(value, issues, path, {max: def.maxLength});
            }
        }

        if (issues.length > startLength) {
            return false;
        }

        const elementDef = def.element!.toCompilerDef() as AnyStandardSchemaDef;
        const basePath = path ? path + '.' : '';

        for (let i = 0; i < value.length; i++) {
            this.validate(elementDef, value[i], issues, basePath + i);
        }

        return issues.length === startLength;
    }

    private validateTuple(def: TupleDef, value: unknown, issues: GGIssuesList, path: string): boolean {

        if (!Array.isArray(value)) {
            return IsTupleErrors.typeError.add(value, issues, path);
        }

        const elements = def.elements!;
        if (value.length !== elements.length) {
            return IsTupleErrors.lengthError.add(value, issues, path, {
                expected: elements.length,
                actual: value.length
            });
        }

        const startLength = issues.length;
        const basePath = path ? path + '.' : '';

        for (let i = 0; i < elements.length; i++) {
            this.validate(elements[i].toCompilerDef() as AnyStandardSchemaDef, value[i], issues, `${basePath}${i}`);
        }

        return issues.length === startLength;
    }

    private validateRecord(def: RecordDef, value: unknown, issues: GGIssuesList, path: string): boolean {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return IsRecordErrors.typeError.add(value, issues, path);
        }

        const startLength = issues.length;
        const basePath = path ? path + '.' : '';
        const keyDef = def.key.toCompilerDef() as AnyStandardSchemaDef;
        const valueDef = def.value.toCompilerDef() as AnyStandardSchemaDef;

        for (const key of Object.keys(value)) {
            const keyPath = `${basePath}${key}`;
            this.validate(keyDef, key, issues, `${keyPath}[key]`);
            this.validate(valueDef, (value as Record<string, unknown>)[key], issues, keyPath);
        }

        return issues.length === startLength;
    }

    private validateUnion(def: UnionDef, value: unknown, issues: GGIssuesList, path: string): boolean {
        // Value has already been cleaned, find a variant that validates it
        for (const variant of def.variants) {
            const tempIssues = new GGIssuesList();
            if (this.validate(variant.toCompilerDef() as AnyStandardSchemaDef, value, tempIssues, path)) {
                return true;
            }
        }

        return IsUnionErrors.unionError.add(value, issues, path);
    }

    private validateDiscriminated(def: DiscriminatedDef, value: unknown, issues: GGIssuesList, path: string): boolean {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return IsDiscriminatedErrors.notObjectError.add(value, issues, path);
        }

        const discriminatorValue = (value as Record<string, unknown>)[def.discriminator];
        if (discriminatorValue === undefined || discriminatorValue === null) {
            return IsDiscriminatedErrors.missingDiscriminatorError.add(value, issues, path, {field: def.discriminator});
        }

        const variant = def.variantMap?.get(discriminatorValue as string | number | boolean);
        if (!variant) {
            return IsDiscriminatedErrors.unknownVariantError.add(value, issues, path, {
                field: def.discriminator,
                value: String(discriminatorValue)
            });
        }

        return this.validate(variant.toCompilerDef() as AnyStandardSchemaDef, value, issues, path);
    }
}
