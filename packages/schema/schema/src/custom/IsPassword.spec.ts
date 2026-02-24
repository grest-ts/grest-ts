import {describe, expect, it} from 'vitest';
import {IsPassword, PasswordSchema} from './IsPassword';
import {GGIssueKey} from "../issue/GGIssueKey";
import {GGIssuesList} from "../issue/GGIssuesList";
import {testValidation, testUtils} from "../utils/testUtils";

testUtils('IsPassword - medium (default)', () => {
    const schema = IsPassword();

    testValidation('validation', schema, [
        // Valid - letters + numbers, 8+ chars
        {value: 'Password1', valid: true},
        {value: 'mypassword123', valid: true},
        {value: 'abc123def', valid: true},
        // Invalid - no letters
        {value: '12345678', valid: false, issue: PasswordSchema.needsLetterError},
        {value: '123456789', valid: false, issue: PasswordSchema.needsLetterError},
        // Invalid - no numbers
        {value: 'password', valid: false, issue: PasswordSchema.needsNumberError},
        {value: 'abcdefgh', valid: false, issue: PasswordSchema.needsNumberError},
        // Invalid - too short
        {value: 'Pass1', valid: false, issue: PasswordSchema.tooShortError},
        {value: 'Pw1', valid: false, issue: PasswordSchema.tooShortError},
        // Non-string values
        {value: 12345678, valid: false, issue: PasswordSchema.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('orUndefined', schema.orUndefined, [
        {value: undefined, valid: true},
        {value: 'Password1', valid: true},
    ]);

    testValidation('orNull', schema.orNull, [
        {value: null, valid: true},
        {value: 'Password1', valid: true},
    ]);
});

testUtils('IsPassword - weak', () => {
    const schema = IsPassword({strength: 'weak'});

    testValidation('validation', schema, [
        // Valid - just length requirement
        {value: 'password', valid: true},
        {value: '12345678', valid: true},
        {value: '!!!!!!!!!', valid: true},
        // Invalid - too short
        {value: 'pass', valid: false, issue: PasswordSchema.tooShortError},
        {value: '1234567', valid: false, issue: PasswordSchema.tooShortError},
    ]);
});

testUtils('IsPassword - strong', () => {
    const schema = IsPassword({strength: 'strong'});

    testValidation('validation', schema, [
        // Valid - lowercase, uppercase, number, special
        {value: 'Password1!', valid: true},
        {value: 'MyP@ssw0rd', valid: true},
        {value: 'Str0ng!Pass', valid: true},
        // Invalid - no lowercase
        {value: 'PASSWORD1!', valid: false, issue: PasswordSchema.needsLowercaseError},
        // Invalid - no uppercase
        {value: 'password1!', valid: false, issue: PasswordSchema.needsUppercaseError},
        // Invalid - no numbers
        {value: 'Password!', valid: false, issue: PasswordSchema.needsNumberError},
        // Invalid - no special characters
        {value: 'Password1', valid: false, issue: PasswordSchema.needsSpecialError},
    ]);

    describe('special characters', () => {
        const specialChars = '!@#$%^&*()-_=+[]{}\'"|\,./<>?`~';
        it.each(specialChars.split(''))('should accept %s as special character', (char) => {
            expect(schema.is(`Password1${char}`)).toBe(true);
        });
    });
});

testUtils('IsPassword - custom length', () => {
    const schema = IsPassword({minLength: 12, maxLength: 64});

    testValidation('validation', schema, [
        // Valid within range
        {value: 'MyPassword123', valid: true},  // 13 chars
        {value: 'a'.repeat(60) + 'Aa1!', valid: true},  // 64 chars
        // Invalid - too short
        {value: 'Password1', valid: false, issue: PasswordSchema.tooShortError},
        {value: 'Password12', valid: false, issue: PasswordSchema.tooShortError},
        {value: 'Password123', valid: false, issue: PasswordSchema.tooShortError},  // 11 chars
        // Invalid - too long
        {value: 'a'.repeat(61) + 'Aa1!', valid: false, issue: PasswordSchema.tooLongError},  // 65 chars
    ]);
});

describe('IsPassword - coercion', () => {
    const schema = IsPassword();

    it('should coerce numbers and fail medium strength validation', () => {
        const issues = new GGIssuesList();
        expect(schema._parse(12345678, issues, 'test', true)).toBeUndefined();
        expect(issues.getIssue(0)?.code).toBe('invalid.password.needsLetter');
    });
});
