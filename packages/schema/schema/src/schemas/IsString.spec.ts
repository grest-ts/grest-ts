import {describe, expect, it} from 'vitest';
import {IsString} from './IsString';
import {GGIssueKey} from "../issue/GGIssueKey";
import {GGIssuesList} from "../issue/GGIssuesList";
import {testCoercion, testStringify, testValidation, testUtils} from "../utils/testUtils";
import {IsStringErrors} from "../Errors";

// Define test issues outside utilsSpec to avoid double registration
const uppercaseError = new GGIssueKey('uppercase', 'Value must be uppercase');
const customPatternError = new GGIssueKey('customPattern', 'Must be alphanumeric');

testUtils(`IsString`, () => {

    testValidation('validation', IsString, [
        {value: '', valid: true},
        {value: 'hello', valid: true},
        {value: 'hello world', valid: true},
        {value: '123', valid: true},
        {value: 123, valid: false, issue: IsStringErrors.typeError},
        {value: true, valid: false, issue: IsStringErrors.typeError},
        {value: false, valid: false, issue: IsStringErrors.typeError},
        {value: {}, valid: false, issue: IsStringErrors.typeError},
        {value: [], valid: false, issue: IsStringErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);

    testCoercion('coercion', IsString, [
        {value: 123, result: '123'},
        {value: 0, result: '0'},
        {value: -42, result: '-42'},
        {value: 3.14, result: '3.14'},
        {value: true, result: 'true'},
        {value: false, result: 'false'},
        {value: NaN, result: undefined, issue: IsStringErrors.typeError},
        {value: {}, result: undefined, issue: IsStringErrors.typeError},
        {value: [], result: undefined, issue: IsStringErrors.typeError},
    ]);

    testCoercion('coercion + nonEmpty', IsString.nonEmpty, [
        {value: 0, result: '0'},
        {value: 123, result: '123'},
        {value: true, result: 'true'},
        {value: false, result: 'false'},
        {value: '', result: undefined, issue: IsStringErrors.nonEmptyError},
    ]);

    testCoercion('coercion + minLength(3)', IsString.minLength(3), [
        {value: 123, result: '123'},
        {value: 1234, result: '1234'},
        {value: 12, result: undefined, issue: IsStringErrors.minLengthError},
        {value: true, result: 'true'},
        {value: false, result: 'false'},
    ]);

    testCoercion('coercion + maxLength(3)', IsString.maxLength(3), [
        {value: 12, result: '12'},
        {value: 123, result: '123'},
        {value: 1234, result: undefined, issue: IsStringErrors.maxLengthError},
        {value: true, result: undefined, issue: IsStringErrors.maxLengthError},
    ]);

    testCoercion('coercion + range(2, 4)', IsString.range(2, 4), [
        {value: 12, result: '12'},
        {value: 123, result: '123'},
        {value: 1234, result: '1234'},
        {value: 1, result: undefined, issue: IsStringErrors.rangeError},
        {value: 12345, result: undefined, issue: IsStringErrors.rangeError},
    ]);

    testValidation('nonEmpty', IsString.nonEmpty, [
        {value: '', valid: false, issue: IsStringErrors.nonEmptyError},
        {value: 'a', valid: true},
        {value: 'hello', valid: true},
        {value: 123, valid: false, issue: IsStringErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('minLength(3)', IsString.minLength(3), [
        {value: '', valid: false, issue: IsStringErrors.minLengthError},
        {value: 'ab', valid: false, issue: IsStringErrors.minLengthError},
        {value: 'abc', valid: true},
        {value: 'abcd', valid: true},
    ]);

    testValidation('maxLength(5)', IsString.maxLength(5), [
        {value: '', valid: true},
        {value: 'abcde', valid: true},
        {value: 'abcdef', valid: false, issue: IsStringErrors.maxLengthError},
        {value: 'abcdefgh', valid: false, issue: IsStringErrors.maxLengthError},
    ]);

    testValidation('range(2, 5)', IsString.range(2, 5), [
        {value: 'a', valid: false, issue: IsStringErrors.rangeError},
        {value: 'ab', valid: true},
        {value: 'abc', valid: true},
        {value: 'abcde', valid: true},
        {value: 'abcdef', valid: false, issue: IsStringErrors.rangeError},
    ]);

    // nonEmpty + minLength combination (regression test for compiled vs fallback consistency)
    testValidation('nonEmpty.minLength(5)', IsString.nonEmpty.minLength(5), [
        {value: '', valid: false, issue: IsStringErrors.nonEmptyError},
        {value: 'a', valid: false, issue: IsStringErrors.minLengthError},
        {value: 'abcd', valid: false, issue: IsStringErrors.minLengthError},
        {value: 'abcde', valid: true},
        {value: 'abcdef', valid: true},
    ]);

    // minLength().maxLength() chaining - same as range(), uses rangeError when both set
    testValidation('minLength(2).maxLength(5)', IsString.minLength(2).maxLength(5), [
        {value: 'a', valid: false, issue: IsStringErrors.rangeError},
        {value: 'ab', valid: true},
        {value: 'abcde', valid: true},
        {value: 'abcdef', valid: false, issue: IsStringErrors.rangeError},
    ]);

    // trim has special behavior: is() rejects untrimmed, parse() passes through (only coercion trims)
    describe('trim', () => {
        it('should reject strings with whitespace in is()', () => {
            expect(IsString.trim.is('  hello  ')).toBe(false);
            expect(IsString.trim.is(' hello')).toBe(false);
            expect(IsString.trim.is('hello ')).toBe(false);
        });

        it('should accept trimmed strings', () => {
            expect(IsString.trim.is('hello')).toBe(true);
            expect(IsString.trim.is('hello world')).toBe(true);
        });

        it('should trim whitespace when coercing', () => {
            const issues = new GGIssuesList();
            expect(IsString.trim._parse('  hello  ', issues, 'test', true)).toBe('hello');
            expect(issues.length).toBe(0);
        });

        it('trim + minLength with coercion validates trimmed result', () => {
            const schema = IsString.trim.minLength(3);
            let issues = new GGIssuesList();
            expect(schema._parse('  abc  ', issues, 'test', true)).toBe('abc');
            expect(issues.length).toBe(0);

            issues = new GGIssuesList();
            expect(schema._parse('  ab  ', issues, 'test', true)).toBeUndefined();
            expect(issues.getIssue(0)).toBe(IsStringErrors.minLengthError);
        });

        it('trim + nonEmpty with coercion rejects whitespace-only', () => {
            const schema = IsString.trim.nonEmpty;
            let issues = new GGIssuesList();
            expect(schema._parse('  hello  ', issues, 'test', true)).toBe('hello');
            expect(issues.length).toBe(0);

            issues = new GGIssuesList();
            expect(schema._parse('   ', issues, 'test', true)).toBeUndefined();
            expect(issues.getIssue(0)).toBe(IsStringErrors.nonEmptyError);
        });
    });

    testValidation('regex /^[a-z0-9]+$/i', IsString.regex(/^[a-z0-9]+$/i), [
        {value: 'hello123', valid: true},
        {value: 'ABC', valid: true},
        {value: 'hello!', valid: false, issue: IsStringErrors.patternError},
        {value: 'hello world', valid: false, issue: IsStringErrors.patternError},
    ]);

    describe('regex patterns', () => {
        it('should handle patterns with forward slashes', () => {
            const urlPath = IsString.regex(/^\/[a-z]+\/[a-z]+$/);
            expect(urlPath.is('/foo/bar')).toBe(true);
            expect(urlPath.is('/foo/bar/')).toBe(false);
            expect(urlPath.is('foo/bar')).toBe(false);
        });

        it('should handle patterns with backslashes', () => {
            const withDigits = IsString.regex(/^\d+\.\d+$/);
            expect(withDigits.is('123.456')).toBe(true);
            expect(withDigits.is('123')).toBe(false);
            expect(withDigits.is('abc.def')).toBe(false);
        });

        it('should handle patterns with special regex chars', () => {
            const specialChars = IsString.regex(/^\$\d+\.\d{2}$/);
            expect(specialChars.is('$10.99')).toBe(true);
            expect(specialChars.is('$10.9')).toBe(false);
            expect(specialChars.is('10.99')).toBe(false);
        });

        it('should handle case-insensitive flag', () => {
            const caseInsensitive = IsString.regex(/^hello$/i);
            expect(caseInsensitive.is('hello')).toBe(true);
            expect(caseInsensitive.is('HELLO')).toBe(true);
            expect(caseInsensitive.is('HeLLo')).toBe(true);
        });

        it('should handle multiline flag', () => {
            const multiline = IsString.regex(/^line$/m);
            expect(multiline.is('line')).toBe(true);
            expect(multiline.is('first\nline\nlast')).toBe(true);
            expect(multiline.is('no match here')).toBe(false);
        });

        it('should handle combined flags', () => {
            const combined = IsString.regex(/^test$/im);
            expect(combined.is('TEST')).toBe(true);
            expect(combined.is('first\nTEST\nlast')).toBe(true);
        });

        it('should handle complex patterns with groups', () => {
            const email = IsString.regex(/^[a-z]+(\.[a-z]+)*@[a-z]+\.[a-z]{2,}$/i);
            expect(email.is('john@example.com')).toBe(true);
            expect(email.is('john.doe@example.com')).toBe(true);
            expect(email.is('invalid')).toBe(false);
        });

        it('should handle patterns with alternation', () => {
            const yesNo = IsString.regex(/^(yes|no)$/i);
            expect(yesNo.is('yes')).toBe(true);
            expect(yesNo.is('NO')).toBe(true);
            expect(yesNo.is('maybe')).toBe(false);
        });

        it('should handle unicode patterns', () => {
            const hasLetters = IsString.regex(/^[\p{L}]+$/u);
            expect(hasLetters.is('hello')).toBe(true);
            expect(hasLetters.is('привет')).toBe(true);
            expect(hasLetters.is('123')).toBe(false);
        });

        it('should work combined with length constraints', () => {
            const constrained = IsString.minLength(3).maxLength(10).regex(/^[a-z]+$/);
            expect(constrained.is('ab')).toBe(false);      // too short
            expect(constrained.is('abc')).toBe(true);
            expect(constrained.is('abcdefghij')).toBe(true);
            expect(constrained.is('abcdefghijk')).toBe(false); // too long
            expect(constrained.is('ABC')).toBe(false);     // wrong case
            expect(constrained.is('abc123')).toBe(false);  // has digits
        });

        it('should use custom error when provided', () => {
            const schema = IsString.regex(/^[a-z0-9]+$/i, customPatternError);
            expect(schema.is('hello123')).toBe(true);
            expect(schema.is('hello!')).toBe(false);

            const issues = new GGIssuesList();
            expect(schema._parse('hello!', issues, 'test')).toBeUndefined();
            expect(issues.getIssue(0)).toBe(customPatternError);
        });

        // Issue #22: Global flag should be stripped to prevent lastIndex state issues
        it('should strip global flag from regex to prevent state issues', () => {
            // With global flag, regex.test() updates lastIndex and gives inconsistent results
            const schema = IsString.regex(/abc/g);

            // Multiple consecutive calls should give consistent results
            // Without the fix, this would alternate between true and false
            expect(schema.is('xabcx')).toBe(true);
            expect(schema.is('xabcx')).toBe(true);
            expect(schema.is('xabcx')).toBe(true);
            expect(schema.is('xabcx')).toBe(true);

            // Also test with custom error path
            const schemaWithError = IsString.regex(/abc/g, customPatternError);
            expect(schemaWithError.is('xabcx')).toBe(true);
            expect(schemaWithError.is('xabcx')).toBe(true);
            expect(schemaWithError.is('xabcx')).toBe(true);
        });
    });

    testValidation('orUndefined', IsString.orUndefined, [
        {value: undefined, valid: true},
        {value: 'hello', valid: true},
        {value: '', valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: 123, valid: false, issue: IsStringErrors.typeError},
    ]);

    testValidation('orNull', IsString.orNull, [
        {value: null, valid: true},
        {value: 'hello', valid: true},
        {value: '', valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: 123, valid: false, issue: IsStringErrors.typeError},
    ]);

    // orUndefined/orNull with constraints
    testValidation('minLength(3).orUndefined', IsString.minLength(3).orUndefined, [
        {value: undefined, valid: true},
        {value: 'abc', valid: true},
        {value: 'abcd', valid: true},
        {value: 'ab', valid: false, issue: IsStringErrors.minLengthError},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('maxLength(5).orNull', IsString.maxLength(5).orNull, [
        {value: null, valid: true},
        {value: '', valid: true},
        {value: 'abcde', valid: true},
        {value: 'abcdef', valid: false, issue: IsStringErrors.maxLengthError},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('brand()', IsString.minLength(1).brand('myBrand'), [
        {value: 'hello', valid: true},
        {value: 'a', valid: true},
        {value: '', valid: false, issue: IsStringErrors.minLengthError},
    ]);

    // default() tests
    describe('default()', () => {
        it('returns default value for undefined', () => {
            const schema = IsString.default('default');
            const issues = new GGIssuesList();
            expect(schema._parse(undefined, issues, 'test', true)).toBe('default');
            expect(issues.length).toBe(0);
        });

        it('returns actual value when provided', () => {
            const schema = IsString.default('default');
            const issues = new GGIssuesList();
            expect(schema._parse('hello', issues, 'test')).toBe('hello');
            expect(issues.length).toBe(0);
        });

        it('coerces null to default value', () => {
            const schema = IsString.default('default');
            const issues = new GGIssuesList();
            expect(schema._parse(null, issues, 'test', true)).toBe('default');
            expect(issues.length).toBe(0);
        });

        it('works with constraints', () => {
            const schema = IsString.minLength(3).default('abc');
            const issues = new GGIssuesList();
            expect(schema._parse(undefined, issues, 'test', true)).toBe('abc');
            expect(issues.length).toBe(0);
        });
    });

    // refine() tests
    describe('refine()', () => {
        const IsUppercase = IsString.refine(s => s === s.toUpperCase(), uppercaseError);

        it('accepts values passing refinement', () => {
            expect(IsUppercase.is('HELLO')).toBe(true);
            expect(IsUppercase.is('ABC')).toBe(true);
            expect(IsUppercase.is('')).toBe(true);
        });

        it('rejects values failing refinement', () => {
            expect(IsUppercase.is('Hello')).toBe(false);
            expect(IsUppercase.is('hello')).toBe(false);
            expect(IsUppercase.is('ABCd')).toBe(false);
        });

        it('adds correct error for failing refinement', () => {
            const issues = new GGIssuesList();
            expect(IsUppercase._parse('hello', issues, 'test')).toBeUndefined();
            expect(issues.getIssue(0)).toBe(uppercaseError);
        });

        it('works with constraints', () => {
            const IsUppercaseMin3 = IsString.minLength(3).refine(s => s === s.toUpperCase(), uppercaseError);
            expect(IsUppercaseMin3.is('ABC')).toBe(true);
            expect(IsUppercaseMin3.is('AB')).toBe(false);  // fails minLength
            expect(IsUppercaseMin3.is('abc')).toBe(false); // fails refine
        });
    });

    describe('constraint tightening', () => {
        it('cannot lower minLength', () => {
            expect(() => IsString.minLength(5).minLength(3)).toThrow('Cannot lower minLength');
        });

        it('cannot raise maxLength', () => {
            expect(() => IsString.maxLength(5).maxLength(10)).toThrow('Cannot raise maxLength');
        });

        it('can tighten minLength', () => {
            const tighter = IsString.minLength(3).minLength(5);
            expect(tighter.is('abcd')).toBe(false);
            expect(tighter.is('abcde')).toBe(true);
        });

        it('can tighten maxLength', () => {
            const tighter = IsString.maxLength(10).maxLength(5);
            expect(tighter.is('abcdef')).toBe(false);
            expect(tighter.is('abcde')).toBe(true);
        });

        it('rejects invalid range', () => {
            expect(() => IsString.range(10, 5)).toThrow('Invalid range');
        });

        it('cannot remove nonEmpty constraint', () => {
            // nonEmpty is a getter, so we test that calling derive internally won't allow removal
            // The only way to test this is through the derive method behavior
            const schema = IsString.nonEmpty;
            expect(schema.is('')).toBe(false);
            expect(schema.is('a')).toBe(true);
        });

        it('cannot remove trim constraint', () => {
            // trim is a getter, so we test that the constraint persists
            const schema = IsString.trim;
            expect(schema.is(' hello ')).toBe(false);
            expect(schema.is('hello')).toBe(true);
        });
    });

    // ==================== toSchemaDescription ====================

    describe('toSchemaDescription()', () => {
        it('basic', () => {
            const desc = IsString.toSchemaDescription();
            expect(desc.node).toEqual({kind: 'string'});
            expect(desc.nullable).toBe(false);
        });
        it('minLength', () => {
            const desc = IsString.minLength(2).toSchemaDescription();
            expect(desc.node).toEqual({kind: 'string', minLength: 2});
        });
        it('maxLength', () => {
            const desc = IsString.maxLength(50).toSchemaDescription();
            expect(desc.node).toEqual({kind: 'string', maxLength: 50});
        });
        it('nonEmpty implies minLength:1', () => {
            const desc = IsString.nonEmpty.toSchemaDescription();
            expect((desc.node as any).minLength).toBe(1);
        });
        it('nonEmpty + explicit minLength keeps explicit value', () => {
            const desc = IsString.nonEmpty.minLength(3).toSchemaDescription();
            expect((desc.node as any).minLength).toBe(3);
        });
        it('pattern', () => {
            const desc = IsString.regex(/^[a-z]+$/).toSchemaDescription();
            expect((desc.node as any).pattern).toBe('^[a-z]+$');
        });
        it('orNull sets nullable:true, node stays string', () => {
            const desc = IsString.orNull.toSchemaDescription();
            expect(desc.node).toEqual({kind: 'string'});
            expect(desc.nullable).toBe(true);
        });
        it('orUndefined sets optional:true, node stays string', () => {
            const desc = IsString.orUndefined.toSchemaDescription();
            expect(desc.node).toEqual({kind: 'string'});
            expect(desc.optional).toBe(true);
            expect(desc.nullable).toBe(false);
        });

        // ── .docs() and .default() — tested on IsString as the simplest carrier ──
        it('docs title', () => {
            const desc = IsString.docs({title: 'My field'}).toSchemaDescription();
            expect(desc.node).toEqual({kind: 'string'});
            expect(desc.docs?.title).toBe('My field');
        });
        it('docs description', () => {
            const desc = IsString.docs({description: 'A description'}).toSchemaDescription();
            expect(desc.docs?.description).toBe('A description');
        });
        it('docs example', () => {
            const desc = IsString.docs({example: 'foo'}).toSchemaDescription();
            expect(desc.docs?.example).toBe('foo');
        });
        it('docs deprecated:true', () => {
            const desc = IsString.docs({deprecated: true}).toSchemaDescription();
            expect(desc.docs?.deprecated).toBe(true);
        });
        it('docs deprecated:false', () => {
            const desc = IsString.docs({deprecated: false}).toSchemaDescription();
            expect(desc.docs?.deprecated).toBe(false);
        });
        it('docs on nullable schema: docs in desc, nullable is true', () => {
            const desc = IsString.docs({title: 'X'}).orNull.toSchemaDescription();
            expect(desc.nullable).toBe(true);
            expect(desc.docs?.title).toBe('X');
            expect(desc.node).toEqual({kind: 'string'});
        });
        it('default value', () => {
            const desc = IsString.default('hello').toSchemaDescription();
            expect(desc.defaultValue).toBe('hello');
        });
        it('default combined with docs', () => {
            const desc = IsString.docs({description: 'D'}).default('x').toSchemaDescription();
            expect(desc.docs?.description).toBe('D');
            expect(desc.defaultValue).toBe('x');
        });
    });

    // ==================== Stringify ====================

    testStringify('stringify', IsString, [
        {value: '', expected: ''},
        {value: 'hello', expected: 'hello'},
        {value: 'hello world', expected: 'hello world'},
        {value: 'special "chars" and \\slashes', expected: 'special "chars" and \\slashes'},
    ]);

    testStringify('stringify orNull', IsString.orNull, [
        {value: 'hello', expected: 'hello'},
        {value: null, expected: null},
    ]);

    describe('stringify orUndefined', () => {
        it('orUndefined.stringify(undefined) returns undefined', () => {
            expect(IsString.orUndefined.stringify(undefined)).toBe(undefined);
        });

        it('orUndefined.stringify(value) returns stringified value', () => {
            expect(IsString.orUndefined.stringify('hello')).toBe('"hello"');
        });
    });

});
