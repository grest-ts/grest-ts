import type {
    ArrayDef,
    DiscriminatedDef,
    GGSchemaDefinition,
    NumberDef,
    ObjectDef,
    RecordDef,
    AnyStandardSchemaDef,
    StringDef,
    TupleDef,
    UnionDef
} from "../../../Definition";
import {roundToMultipleOf} from "./CODE_Is";

/**
 * CleanInterpreter - handles value transformation/normalization.
 *
 * Separated from validation - clean happens first, then validate.
 * When transform=true, performs type coercion (string→number, etc.)
 * When transform=false, only performs normalization (trim, etc.)
 */
export class CODE_Clean {
    private static _instance: CODE_Clean;

    static get instance(): CODE_Clean {
        return this._instance ??= new CODE_Clean();
    }

    /**
     * Clean/transform a value according to its schema definition.
     * Returns the cleaned value (may be same reference for primitives).
     */
    clean(def: AnyStandardSchemaDef, value: unknown, transform: boolean = false): unknown {
        if (value === undefined || value === null) return value;
        value = this.cleanType(def, value, transform);
        // Apply user-defined coercions when transform=true
        // If a coercion throws, skip it and keep the current value
        if (transform && def.coercions) {
            for (const fn of def.coercions) {
                try {
                    value = fn(value);
                } catch {
                    // Coercion failed, keep current value (validation will fail later)
                }
            }
        }
        return value;
    }

    private cleanType(def: AnyStandardSchemaDef, value: unknown, transform: boolean): unknown {
        switch (def.type) {
            case 'string':
                return this.cleanString(def, value, transform);
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
                return this.cleanNumber(def as NumberDef, value, transform);
            case 'boolean':
                return this.cleanBoolean(value, transform);
            case 'bit':
                return this.cleanBit(value, transform);
            case 'object':
                return this.cleanObject(def, value, transform);
            case 'array':
                return this.cleanArray(def, value, transform);
            case 'tuple':
                return this.cleanTuple(def, value, transform);
            case 'record':
                return this.cleanRecord(def, value, transform);
            case 'union':
                return this.cleanUnion(def, value, transform);
            case 'discriminated':
                return this.cleanDiscriminated(def, value, transform);
            // Primitives that need no cleaning
            case 'literal':
            case 'any':
            case 'unknown':
                return value;
            // Custom types (e.g., file) use def.clean if registered
            default: {
                const baseDef = def as GGSchemaDefinition;
                if (baseDef.clean) {
                    return baseDef.clean(value, transform);
                }
                return value;
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Primitives
    // ──────────────────────────────────────────────────────────────────────────

    private cleanString(def: StringDef, value: unknown, transform: boolean): unknown {
        // Type coercion only when transform=true
        if (transform) {
            if (typeof value === 'number' && !isNaN(value)) {
                value = String(value);
            } else if (typeof value === 'boolean') {
                value = String(value);
            }
        }
        // Trim is normalization, always apply if configured
        if (typeof value === 'string' && def.trim) {
            value = value.trim();
        }
        return value;
    }

    private cleanNumber(def: NumberDef, value: unknown, transform: boolean): unknown {
        // Type coercion only when transform=true
        if (transform && typeof value === 'string') {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                value = parsed;
            }
        }
        // Round to nearest multipleOf when transform=true
        if (transform && typeof value === 'number' && Number.isFinite(value) && def.multipleOf !== undefined) {
            value = roundToMultipleOf(value, def.multipleOf);
        }
        return value;
    }

    private cleanBoolean(value: unknown, transform: boolean): unknown {
        // Type coercion only when transform=true
        if (transform) {
            if (value === true || value === 'true' || value === '1' || value === 1) {
                return true;
            }
            if (value === false || value === 'false' || value === '0' || value === 0) {
                return false;
            }
        }
        return value;
    }

    private cleanBit(value: unknown, transform: boolean): unknown {
        // Type coercion only when transform=true
        if (transform) {
            if (value === true || value === 'true' || value === '1' || value === 1) return 1;
            if (value === false || value === 'false' || value === '0' || value === 0) return 0;
        }
        return value;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Structural
    // ──────────────────────────────────────────────────────────────────────────

    private cleanObject(def: ObjectDef, value: unknown, transform: boolean): unknown {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;

        const shape = def.shape!;
        const result: Record<string, unknown> = {};
        const obj = value as Record<string, unknown>;

        for (const k in shape) {
            const fieldSchema = shape[k];
            if (fieldSchema && typeof fieldSchema === 'object' && 'def' in fieldSchema) {
                const fieldDef = fieldSchema.toCompilerDef() as AnyStandardSchemaDef;
                const fieldValue = k in obj ? obj[k] : undefined;
                // Apply default for null/undefined field values (only when transforming/coercing)
                if (transform && fieldValue == null && fieldDef.defaultValue !== undefined) {
                    result[k] = fieldDef.defaultValue;
                } else if (k in obj) {
                    result[k] = this.clean(fieldDef, fieldValue, transform);
                }
            } else if (k in obj) {
                result[k] = obj[k];
            }
        }
        return result;
    }

    private cleanArray(def: ArrayDef, value: unknown, transform: boolean): unknown {
        if (!Array.isArray(value)) return value;

        const element = def.element!;
        const elemDef = element.toCompilerDef() as AnyStandardSchemaDef;
        const result: unknown[] = new Array(value.length);

        for (let i = 0; i < value.length; i++) {
            result[i] = this.clean(elemDef, value[i], transform);
        }
        return result;
    }

    private cleanTuple(def: TupleDef, value: unknown, transform: boolean): unknown {
        if (!Array.isArray(value)) return value;

        const elements = def.elements!;
        // Preserve original array length for validation to detect length errors
        const result: unknown[] = new Array(value.length);

        for (let i = 0; i < value.length; i++) {
            if (i < elements.length) {
                const elemDef = elements[i].toCompilerDef() as AnyStandardSchemaDef;
                result[i] = this.clean(elemDef, value[i], transform);
            } else {
                // Keep extra elements as-is for validation to report length error
                result[i] = value[i];
            }
        }
        return result;
    }

    private cleanRecord(def: RecordDef, value: unknown, transform: boolean): unknown {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return value;
        }

        const keyDef = def.key.toCompilerDef() as AnyStandardSchemaDef;
        const valueDef = def.value.toCompilerDef() as AnyStandardSchemaDef;
        const result: Record<string, unknown> = {};

        for (const key of Object.keys(value)) {
            const cleanedKey = this.clean(keyDef, key, transform) as string;
            result[cleanedKey] = this.clean(valueDef, (value as Record<string, unknown>)[key], transform);
        }
        return result;
    }

    private cleanUnion(def: UnionDef, value: unknown, transform: boolean): unknown {
        const variants = def.variants;

        // Try to find a variant that matches and clean with it
        for (const variant of variants) {
            if (variant.is(value)) {
                const variantDef = variant.toCompilerDef() as AnyStandardSchemaDef;
                return this.clean(variantDef, value, transform);
            }
        }

        // If transform is enabled, try cleaning with each variant and see if any becomes valid
        if (transform) {
            for (const variant of variants) {
                const variantDef = variant.toCompilerDef() as AnyStandardSchemaDef;
                const cleaned = this.clean(variantDef, value, transform);
                if (variant.is(cleaned)) {
                    return cleaned;
                }
            }
        }

        // Return as-is, validation will fail
        return value;
    }

    private cleanDiscriminated(def: DiscriminatedDef, value: unknown, transform: boolean): unknown {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return value;
        }

        const discriminatorValue = (value as Record<string, unknown>)[def.discriminator];
        if (discriminatorValue === undefined || discriminatorValue === null) {
            return value;
        }

        const variant = def.variantMap?.get(discriminatorValue as string | number | boolean);
        if (!variant) {
            return value;
        }

        const variantDef = variant.toCompilerDef() as AnyStandardSchemaDef;
        return this.clean(variantDef, value, transform);
    }
}
