import type {
    ArrayDef,
    DiscriminatedDef,
    GGSchemaDefinition,
    LiteralDef,
    NumberDef,
    ObjectDef,
    RecordDef,
    AnyStandardSchemaDef,
    StringDef,
    TupleDef,
    UnionDef
} from "../../../Definition";

/**
 * Check if a value is a multiple of another, handling floating point precision.
 * Uses quotient comparison to avoid modulo precision issues.
 */
export function isMultipleOf(value: number, multipleOf: number): boolean {
    const quotient = value / multipleOf;
    return Math.abs(Math.round(quotient) - quotient) < 1e-10;
}

/**
 * Round a value to the nearest multiple, handling floating point precision.
 * Used for coercion - rounds to nearest multipleOf value.
 */
export function roundToMultipleOf(value: number, multipleOf: number): number {
    // Add tiny epsilon adjustment to handle .5 cases correctly
    // (e.g., 0.15 / 0.1 = 1.4999999999999998 instead of 1.5)
    const quotient = value / multipleOf;
    const rounded = Math.round(quotient + 1e-14 * Math.sign(quotient));
    const result = rounded * multipleOf;
    // Clean floating point artifacts (e.g., 0.30000000000000004 → 0.3)
    // Use toPrecision to get 15 significant digits (JavaScript's practical precision)
    return parseFloat(result.toPrecision(15));
}

/**
 * IsInterpreter - fast boolean validation without error collection.
 *
 * This is the "fast path" for validation - returns boolean only.
 * For error details, use ValidateInterpreter.
 */
export class CODE_Is {
    private static _instance: CODE_Is;

    static get instance(): CODE_Is {
        return this._instance ??= new CODE_Is();
    }

    /**
     * Check if a value matches a schema definition.
     * Handles undefined/null, type-specific checks, and refinements.
     */
    is(def: AnyStandardSchemaDef, value: unknown): boolean {
        // Handle undefined
        if (value === undefined) return def.optional === true;
        // Handle null
        if (value === null) return def.nullable === true;
        // Type-specific check
        if (!this.checkType(def, value)) return false;
        // Refinements
        if (def.refinements) {
            for (const r of def.refinements) {
                if (!r.check(value)) return false;
            }
        }
        return true;
    }

    private checkType(def: AnyStandardSchemaDef, value: unknown): boolean {
        switch (def.type) {
            case 'string':
                return this.checkString(def, value);
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
                return this.checkNumber(def, value);
            case 'boolean':
                return typeof value === 'boolean';
            case 'bit':
                return value === 0 || value === 1;
            case 'literal':
                return this.checkLiteral(def, value);
            case 'object':
                return this.checkObject(def, value);
            case 'array':
                return this.checkArray(def, value);
            case 'tuple':
                return this.checkTuple(def, value);
            case 'record':
                return this.checkRecord(def, value);
            case 'union':
                return this.checkUnion(def, value);
            case 'discriminated':
                return this.checkDiscriminated(def, value);
            case 'any':
            case 'unknown':
                return true;
            // Custom types (e.g., file) use def.is if registered
            default: {
                const baseDef = def as GGSchemaDefinition;
                if (baseDef.is) {
                    return baseDef.is(value);
                }
                return false;
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Primitives
    // ──────────────────────────────────────────────────────────────────────────

    private checkString(def: StringDef, value: unknown): boolean {
        if (typeof value !== 'string') return false;
        if (def.trim && value.trim() !== value) return false;
        if (def.nonEmpty && value.length === 0) return false;
        if (def.minLength !== undefined && value.length < def.minLength) return false;
        if (def.maxLength !== undefined && value.length > def.maxLength) return false;
        if (def.pattern && !def.pattern.test(value)) return false;
        return true;
    }

    private checkNumber(def: NumberDef, value: unknown): boolean {
        if (typeof value !== 'number' || !Number.isFinite(value)) return false;
        if (def.integer && !Number.isInteger(value)) return false;
        if (def.min !== undefined && value < def.min) return false;
        if (def.max !== undefined && value > def.max) return false;
        if (def.multipleOf !== undefined && !isMultipleOf(value, def.multipleOf)) return false;
        return true;
    }

    private checkLiteral(def: LiteralDef, value: unknown): boolean {
        const values = def.values;
        // For small sets, linear search; for larger, use Set
        if (values.length > 10) {
            return new Set(values).has(value as any);
        }
        for (const val of values) {
            if (value === val) return true;
        }
        return false;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Structural
    // ──────────────────────────────────────────────────────────────────────────

    private checkObject(def: ObjectDef, value: unknown): boolean {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

        const shape = def.shape!;
        for (const k in shape) {
            const fieldSchema = shape[k];
            if (fieldSchema && typeof fieldSchema === 'object' && 'def' in fieldSchema) {
                if (!fieldSchema.is((value as any)[k])) return false;
            }
        }
        return true;
    }

    private checkArray(def: ArrayDef, value: unknown): boolean {
        if (!Array.isArray(value)) return false;
        if (def.minLength !== undefined && value.length < def.minLength) return false;
        if (def.maxLength !== undefined && value.length > def.maxLength) return false;

        const element = def.element!;
        for (let i = 0; i < value.length; i++) {
            if (!element.is(value[i])) return false;
        }
        return true;
    }

    private checkTuple(def: TupleDef, value: unknown): boolean {
        if (!Array.isArray(value)) return false;
        const elements = def.elements!;
        if (value.length !== elements.length) return false;

        for (let i = 0; i < elements.length; i++) {
            if (!elements[i].is(value[i])) return false;
        }
        return true;
    }

    private checkRecord(def: RecordDef, value: unknown): boolean {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

        for (const key of Object.keys(value)) {
            if (!def.key.is(key)) return false;
            if (!def.value.is((value as Record<string, unknown>)[key])) return false;
        }
        return true;
    }

    private checkUnion(def: UnionDef, value: unknown): boolean {
        for (const variant of def.variants) {
            if (variant.is(value)) return true;
        }
        return false;
    }

    private checkDiscriminated(def: DiscriminatedDef, value: unknown): boolean {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

        const discriminatorValue = (value as Record<string, unknown>)[def.discriminator];
        if (discriminatorValue === undefined || discriminatorValue === null) return false;

        const variant = def.variantMap?.get(discriminatorValue as string | number | boolean);
        if (!variant) return false;

        return variant.is(value);
    }
}
