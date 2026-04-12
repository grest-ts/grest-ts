import {GGSchema, Opt} from "../GGSchema";
import {GGIssuesList} from "../issue/GGIssuesList";
import {GGIssueInvalid} from "../issue/issues/GGIssueInvalid";
import {GGSchemaDefinition} from "../Definition";
import type {OpenAPIV3_1} from "openapi-types";


// Character class patterns
const HAS_LOWERCASE = /[a-z]/;
const HAS_UPPERCASE = /[A-Z]/;
const HAS_NUMBER = /[0-9]/;
const HAS_SPECIAL = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/;
const HAS_LETTER = /[a-zA-Z]/;

export type PasswordStrength = 'weak' | 'medium' | 'strong';

export interface PasswordOptions {
    minLength?: number;
    maxLength?: number;
    strength?: PasswordStrength;
}

export interface PasswordDef extends GGSchemaDefinition {
    readonly type: 'password';
    readonly minLength: number;
    readonly maxLength: number;
    readonly strength: PasswordStrength;
}

interface tPassword extends String {
    readonly __brand: "password";
}

export class PasswordSchema<T extends tPassword | undefined | null = tPassword> extends GGSchema<T, PasswordDef> {
    public static readonly typeError = new GGIssueInvalid("password.type", "Value must be a string");
    public static readonly tooShortError = new GGIssueInvalid<{ min: number }>("password.tooShort", "Password must be at least {min} characters", {min: "Minimum length"});
    public static readonly tooLongError = new GGIssueInvalid<{ max: number }>("password.tooLong", "Password must be at most {max} characters", {max: "Maximum length"});
    public static readonly needsLetterError = new GGIssueInvalid("password.needsLetter", "Password must contain at least one letter");
    public static readonly needsNumberError = new GGIssueInvalid("password.needsNumber", "Password must contain at least one number");
    public static readonly needsLowercaseError = new GGIssueInvalid("password.needsLowercase", "Password must contain at least one lowercase letter");
    public static readonly needsUppercaseError = new GGIssueInvalid("password.needsUppercase", "Password must contain at least one uppercase letter");
    public static readonly needsSpecialError = new GGIssueInvalid("password.needsSpecial", "Password must contain at least one special character");

    protected _buildDerived<NewT extends tPassword | undefined | null = T>(changes: Partial<PasswordDef>): PasswordSchema<NewT> {
        return new PasswordSchema<NewT>({...this.def, ...changes});
    }

    get orUndefined(): PasswordSchema<T | undefined> & Opt {
        return super.orUndefined as any
    }

    get orNull(): PasswordSchema<T | null> {
        return super.orNull as any
    }

    protected _buildJsonSchema(): OpenAPIV3_1.SchemaObject {
        return {
            type: 'string',
            minLength: this.def.minLength,
            maxLength: this.def.maxLength,
        };
    }
}

// Helper to check password constraints
function checkPassword(value: string, minLength: number, maxLength: number, strength: PasswordStrength): string | null {
    if (value.length < minLength) return 'tooShort';
    if (value.length > maxLength) return 'tooLong';
    if (strength === 'weak') return null;

    if (strength === 'medium') {
        if (!HAS_LETTER.test(value)) return 'needsLetter';
        if (!HAS_NUMBER.test(value)) return 'needsNumber';
        return null;
    }

    // Strong
    if (!HAS_LOWERCASE.test(value)) return 'needsLowercase';
    if (!HAS_UPPERCASE.test(value)) return 'needsUppercase';
    if (!HAS_NUMBER.test(value)) return 'needsNumber';
    if (!HAS_SPECIAL.test(value)) return 'needsSpecial';
    return null;
}

/**
 * Password validator factory.
 *
 * Strength levels:
 * - weak: Only length requirements
 * - medium: Length + requires letters and numbers
 * - strong: Length + requires lowercase, uppercase, number, and special character
 *
 * @example
 * const schema = IsPassword(); // default: min 8, max 128, medium strength
 * const strong = IsPassword({ minLength: 12, strength: 'strong' });
 */
export const IsPassword = (options?: PasswordOptions): PasswordSchema => {
    const minLength = options?.minLength ?? 8;
    const maxLength = options?.maxLength ?? 128;
    const strength = options?.strength ?? 'medium';

    // Create validation functions with closure over options
    const is = (value: unknown): value is tPassword => {
        if (typeof value !== 'string') return false;
        return checkPassword(value, minLength, maxLength, strength) === null;
    };

    const isWithErrors = (value: unknown, issues: GGIssuesList, path: string): value is tPassword => {
        if (typeof value !== 'string') {
            return PasswordSchema.typeError.add(value, issues, path);
        }
        const errorCode = checkPassword(value, minLength, maxLength, strength);
        if (errorCode === null) {
            return true;
        }
        switch (errorCode) {
            case 'tooShort':
                return PasswordSchema.tooShortError.add(value, issues, path, {min: minLength});
            case 'tooLong':
                return PasswordSchema.tooLongError.add(value, issues, path, {max: maxLength});
            case 'needsLetter':
                return PasswordSchema.needsLetterError.add(value, issues, path);
            case 'needsNumber':
                return PasswordSchema.needsNumberError.add(value, issues, path);
            case 'needsLowercase':
                return PasswordSchema.needsLowercaseError.add(value, issues, path);
            case 'needsUppercase':
                return PasswordSchema.needsUppercaseError.add(value, issues, path);
            case 'needsSpecial':
                return PasswordSchema.needsSpecialError.add(value, issues, path);
            default:
                return false;
        }
    };

    const clean = (value: unknown, transform?: boolean): unknown => {
        if (transform && typeof value === 'number' && !isNaN(value)) {
            return String(value);
        }
        return value;
    };

    return new PasswordSchema({
        type: 'password',
        minLength,
        maxLength,
        strength,
        is,
        isWithErrors,
        clean,
        docs: {format: 'password'}
    } as PasswordDef);
};

export type {tPassword};
