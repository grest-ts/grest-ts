import {IsEmail} from './IsEmail';
import {GGIssueKey} from "../issue/GGIssueKey";
import {testStringify, testValidation, testUtils} from "../utils/testUtils";
import {IsStringErrors} from "../Errors";


testUtils('IsEmail', () => {

    testStringify('stringify', IsEmail, [
        {value: 'user@example.com', expected: 'user@example.com'},
        {value: 'test+tag@domain.co.uk', expected: 'test+tag@domain.co.uk'},
    ]);

    testValidation('validation', IsEmail, [
        // Valid email addresses
        {value: 'user@example.com', valid: true},
        {value: 'test@test.org', valid: true},
        {value: 'email@domain.co', valid: true},
        // Subdomains
        {value: 'user@mail.example.com', valid: true},
        {value: 'admin@sub.domain.org', valid: true},
        // Country TLDs
        {value: 'user@example.co.uk', valid: true},
        {value: 'test@domain.com.br', valid: true},
        // Plus signs, dots, underscores, hyphens
        {value: 'user+tag@example.com', valid: true},
        {value: 'first.last@example.com', valid: true},
        {value: 'user_name@example.com', valid: true},
        {value: 'user-name@example.com', valid: true},
        {value: 'test@domain-name.org', valid: true},
        // Numbers
        {value: 'user123@example.com', valid: true},
        {value: 'test@domain123.org', valid: true},
        // Invalid - missing parts
        {value: 'userexample.com', valid: false, issue: IsEmail.emailError},
        {value: 'invalid', valid: false, issue: IsEmail.emailError},
        {value: 'user@', valid: false, issue: IsEmail.emailError},
        {value: 'user@.', valid: false, issue: IsEmail.emailError},
        {value: '@example.com', valid: false, issue: IsEmail.emailError},
        // Invalid - spaces
        {value: 'user @example.com', valid: false, issue: IsEmail.emailError},
        {value: 'user@ example.com', valid: false, issue: IsEmail.emailError},
        {value: ' user@example.com', valid: false, issue: IsEmail.emailError},
        {value: 'user@example.com ', valid: false, issue: IsEmail.emailError},
        // Invalid - no TLD
        {value: 'user@domain', valid: false, issue: IsEmail.emailError},
        {value: 'user@localhost', valid: false, issue: IsEmail.emailError},
        // Empty string
        {value: '', valid: false, issue: IsEmail.emailError},
        // Edge cases - consecutive dots
        {value: 'user..name@example.com', valid: false, issue: IsEmail.emailError},
        {value: 'user...name@example.com', valid: false, issue: IsEmail.emailError},
        // Edge cases - leading/trailing dots in local part
        {value: '.user@example.com', valid: false, issue: IsEmail.emailError},
        {value: 'user.@example.com', valid: false, issue: IsEmail.emailError},
        // Edge cases - multiple subdomains
        {value: 'user@a.b.c.d.example.com', valid: true},
        // Edge cases - long local part (near 64 char limit)
        {value: 'a'.repeat(64) + '@example.com', valid: true},
        {value: 'a'.repeat(65) + '@example.com', valid: false, issue: IsEmail.emailError},
        // Edge cases - very long email (near 254 char limit)
        // The domain part has max 63 chars per label, so we create valid subdomains
        {value: 'user@' + 'a'.repeat(61) + '.' + 'b'.repeat(61) + '.' + 'c'.repeat(61) + '.' + 'd'.repeat(50) + '.com', valid: true},
        {value: 'user@' + 'a'.repeat(61) + '.' + 'b'.repeat(61) + '.' + 'c'.repeat(61) + '.' + 'd'.repeat(61) + '.com', valid: false, issue: IsEmail.emailError},
        // Non-string values
        {value: 123, valid: false, issue: IsStringErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: {}, valid: false, issue: IsStringErrors.typeError},
        {value: [], valid: false, issue: IsStringErrors.typeError},
    ]);

    testValidation('orUndefined', IsEmail.orUndefined, [
        {value: undefined, valid: true},
        {value: 'user@example.com', valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('orNull', IsEmail.orNull, [
        {value: null, valid: true},
        {value: 'user@example.com', valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);
});
