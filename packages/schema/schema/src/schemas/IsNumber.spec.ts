import {describe, expect, it} from 'vitest';
import {IsNumber, NumberSchema} from './IsNumber';
import {GGIssueKey} from "../issue/GGIssueKey";
import {GGIssuesList} from "../issue/GGIssuesList";
import {testCoercion, testStringify, testValidation, testUtils} from "../utils/testUtils";
import {IsNumberErrors} from "../Errors";

// Define test issues outside utilsSpec to avoid double registration
const evenError = new GGIssueKey('even', 'Value must be even');

testUtils(`IsNumber`, () => {

    testValidation('validation', IsNumber, [
        {value: 0, valid: true},
        {value: 42, valid: true},
        {value: -42, valid: true},
        {value: 3.14, valid: true},
        {value: -3.14, valid: true},
        {value: Number.MAX_VALUE, valid: true},
        {value: Number.MIN_VALUE, valid: true},
        {value: Infinity, valid: false, issue: IsNumberErrors.typeError},
        {value: -Infinity, valid: false, issue: IsNumberErrors.typeError},
        {value: NaN, valid: false, issue: IsNumberErrors.typeError},
        {value: '42', valid: false, issue: IsNumberErrors.typeError},
        {value: '', valid: false, issue: IsNumberErrors.typeError},
        {value: true, valid: false, issue: IsNumberErrors.typeError},
        {value: false, valid: false, issue: IsNumberErrors.typeError},
        {value: {}, valid: false, issue: IsNumberErrors.typeError},
        {value: [], valid: false, issue: IsNumberErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);

    testCoercion('coercion', IsNumber, [
        {value: '42', result: 42},
        {value: '3.14', result: 3.14},
        {value: '-42', result: -42},
        {value: '0', result: 0},
        {value: '', result: 0},
        {value: 'hello', result: undefined, issue: IsNumberErrors.typeError},
        {value: 'NaN', result: undefined, issue: IsNumberErrors.typeError},
        {value: '12abc', result: undefined, issue: IsNumberErrors.typeError},
        // Edge cases
        {value: '007', result: 7},        // Leading zeros
        {value: '00', result: 0},          // Multiple leading zeros
        {value: '  42  ', result: 42},     // Whitespace (Number() trims)
        {value: '\t5', result: 5},         // Tab
        {value: '1e10', result: 1e10},     // Scientific notation
        {value: '1e308', result: 1e308},   // Near MAX_VALUE
        {value: '1e309', result: undefined, issue: IsNumberErrors.typeError}, // Overflow to Infinity (rejected)
        {value: 'Infinity', result: undefined, issue: IsNumberErrors.typeError},
        {value: '-Infinity', result: undefined, issue: IsNumberErrors.typeError},
    ]);

    testCoercion('coercion + min(0)', IsNumber.min(0), [
        {value: '42', result: 42},
        {value: '0', result: 0},
        {value: '-5', result: undefined, issue: IsNumberErrors.minError},
        {value: 'hello', result: undefined, issue: IsNumberErrors.typeError},
    ]);

    testCoercion('coercion + max(100)', IsNumber.max(100), [
        {value: '50', result: 50},
        {value: '100', result: 100},
        {value: '150', result: undefined, issue: IsNumberErrors.maxError},
        {value: 'hello', result: undefined, issue: IsNumberErrors.typeError},
    ]);

    testCoercion('coercion + range(0, 100)', IsNumber.range(0, 100), [
        {value: '50', result: 50},
        {value: '0', result: 0},
        {value: '100', result: 100},
        {value: '-5', result: undefined, issue: IsNumberErrors.rangeError},
        {value: '150', result: undefined, issue: IsNumberErrors.rangeError},
        {value: 'hello', result: undefined, issue: IsNumberErrors.typeError},
    ]);

    testValidation('min(0)', IsNumber.min(0), [
        {value: -1, valid: false, issue: IsNumberErrors.minError},
        {value: -100, valid: false, issue: IsNumberErrors.minError},
        {value: -Infinity, valid: false, issue: IsNumberErrors.typeError},
        {value: 0, valid: true},
        {value: 1, valid: true},
        {value: 100, valid: true},
        {value: Infinity, valid: false, issue: IsNumberErrors.typeError},
    ]);

    testValidation('max(100)', IsNumber.max(100), [
        {value: 101, valid: false, issue: IsNumberErrors.maxError},
        {value: 1000, valid: false, issue: IsNumberErrors.maxError},
        {value: Infinity, valid: false, issue: IsNumberErrors.typeError},
        {value: 100, valid: true},
        {value: 0, valid: true},
        {value: -100, valid: true},
        {value: -Infinity, valid: false, issue: IsNumberErrors.typeError},
    ]);

    testValidation('range(0, 100)', IsNumber.range(0, 100), [
        {value: -1, valid: false, issue: IsNumberErrors.rangeError},
        {value: 101, valid: false, issue: IsNumberErrors.rangeError},
        {value: 0, valid: true},
        {value: 50, valid: true},
        {value: 100, valid: true},
    ]);

    testValidation('orUndefined', IsNumber.orUndefined, [
        {value: undefined, valid: true},
        {value: 42, valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: 'hello', valid: false, issue: IsNumberErrors.typeError},
    ]);

    testValidation('orNull', IsNumber.orNull, [
        {value: null, valid: true},
        {value: 42, valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: 'hello', valid: false, issue: IsNumberErrors.typeError},
    ]);

    testValidation('brand()', IsNumber.min(0).brand('positive'), [
        {value: 42, valid: true},
        {value: 0, valid: true},
        {value: -1, valid: false, issue: IsNumberErrors.minError},
    ]);

    // Integer schema tests
    const IsInteger = new NumberSchema({type: 'int', integer: true});

    testValidation('integer', IsInteger, [
        {value: 0, valid: true},
        {value: 42, valid: true},
        {value: -42, valid: true},
        {value: 3.14, valid: false, issue: IsNumberErrors.integerError},
        {value: -3.14, valid: false, issue: IsNumberErrors.integerError},
        {value: 0.1, valid: false, issue: IsNumberErrors.integerError},
        {value: Infinity, valid: false, issue: IsNumberErrors.typeError},
        {value: -Infinity, valid: false, issue: IsNumberErrors.typeError},
        {value: NaN, valid: false, issue: IsNumberErrors.typeError},
        {value: '42', valid: false, issue: IsNumberErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testCoercion('integer + coercion', IsInteger, [
        {value: '42', result: 42},
        {value: '-10', result: -10},
        {value: '3.14', result: undefined, issue: IsNumberErrors.integerError},
        {value: '0.5', result: undefined, issue: IsNumberErrors.integerError},
        {value: 'hello', result: undefined, issue: IsNumberErrors.typeError},
    ]);

    // min().max() chaining - same as range(), uses rangeError when both set
    testValidation('min(0).max(100)', IsNumber.min(0).max(100), [
        {value: -1, valid: false, issue: IsNumberErrors.rangeError},
        {value: 101, valid: false, issue: IsNumberErrors.rangeError},
        {value: 0, valid: true},
        {value: 50, valid: true},
        {value: 100, valid: true},
    ]);

    // orUndefined/orNull with constraints
    testValidation('min(0).orUndefined', IsNumber.min(0).orUndefined, [
        {value: undefined, valid: true},
        {value: 0, valid: true},
        {value: 10, valid: true},
        {value: -1, valid: false, issue: IsNumberErrors.minError},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('max(100).orNull', IsNumber.max(100).orNull, [
        {value: null, valid: true},
        {value: 0, valid: true},
        {value: 100, valid: true},
        {value: 101, valid: false, issue: IsNumberErrors.maxError},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);

    // default() tests
    describe('default()', () => {
        it('returns default value for undefined', () => {
            const schema = IsNumber.default(42);
            const issues = new GGIssuesList();
            expect(schema._parse(undefined, issues, 'test', true)).toBe(42);
            expect(issues.length).toBe(0);
        });

        it('returns actual value when provided', () => {
            const schema = IsNumber.default(42);
            const issues = new GGIssuesList();
            expect(schema._parse(100, issues, 'test')).toBe(100);
            expect(issues.length).toBe(0);
        });

        it('coerces null to default value', () => {
            const schema = IsNumber.default(42);
            const issues = new GGIssuesList();
            expect(schema._parse(null, issues, 'test', true)).toBe(42);
            expect(issues.length).toBe(0);
        });

        it('works with constraints', () => {
            const schema = IsNumber.min(0).default(10);
            const issues = new GGIssuesList();
            expect(schema._parse(undefined, issues, 'test', true)).toBe(10);
            expect(issues.length).toBe(0);
        });
    });

    // refine() tests
    describe('refine()', () => {
        const IsEven = IsNumber.refine(n => n % 2 === 0, evenError);

        it('accepts values passing refinement', () => {
            expect(IsEven.is(0)).toBe(true);
            expect(IsEven.is(2)).toBe(true);
            expect(IsEven.is(-4)).toBe(true);
        });

        it('rejects values failing refinement', () => {
            expect(IsEven.is(1)).toBe(false);
            expect(IsEven.is(3)).toBe(false);
            expect(IsEven.is(-5)).toBe(false);
        });

        it('adds correct error for failing refinement', () => {
            const issues = new GGIssuesList();
            expect(IsEven._parse(3, issues, 'test')).toBeUndefined();
            expect(issues.getIssue(0)).toBe(evenError);
        });

        it('works with constraints', () => {
            const IsPositiveEven = IsNumber.min(0).refine(n => n % 2 === 0, evenError);
            expect(IsPositiveEven.is(2)).toBe(true);
            expect(IsPositiveEven.is(-2)).toBe(false);  // fails min
            expect(IsPositiveEven.is(3)).toBe(false);   // fails refine
        });
    });

    describe('constraint tightening', () => {
        it('cannot lower min', () => {
            expect(() => IsNumber.min(5).min(3)).toThrow('Cannot lower min');
        });

        it('cannot raise max', () => {
            expect(() => IsNumber.max(5).max(10)).toThrow('Cannot raise max');
        });

        it('can tighten min', () => {
            const tighter = IsNumber.min(3).min(5);
            expect(tighter.is(4)).toBe(false);
            expect(tighter.is(5)).toBe(true);
        });

        it('can tighten max', () => {
            const tighter = IsNumber.max(10).max(5);
            expect(tighter.is(6)).toBe(false);
            expect(tighter.is(5)).toBe(true);
        });

        it('rejects invalid range', () => {
            expect(() => IsNumber.range(10, 5)).toThrow('Invalid range');
        });
    });

    // ==================== multipleOf ====================

    testValidation('multipleOf(5) - integers', IsNumber.multipleOf(5), [
        {value: 0, valid: true},
        {value: 5, valid: true},
        {value: 10, valid: true},
        {value: -5, valid: true},
        {value: -10, valid: true},
        {value: 100, valid: true},
        {value: 1, valid: false, issue: IsNumberErrors.multipleOfError},
        {value: 3, valid: false, issue: IsNumberErrors.multipleOfError},
        {value: 7, valid: false, issue: IsNumberErrors.multipleOfError},
        {value: -3, valid: false, issue: IsNumberErrors.multipleOfError},
        {value: 12, valid: false, issue: IsNumberErrors.multipleOfError},
    ]);

    testValidation('multipleOf(0.1) - floating point precision', IsNumber.multipleOf(0.1), [
        {value: 0, valid: true},
        {value: 0.1, valid: true},
        {value: 0.2, valid: true},
        {value: 0.3, valid: true},  // Would fail with naive modulo
        {value: 0.5, valid: true},
        {value: 1.0, valid: true},
        {value: -0.3, valid: true},
        {value: 0.15, valid: false, issue: IsNumberErrors.multipleOfError},
        {value: 0.33, valid: false, issue: IsNumberErrors.multipleOfError},
    ]);

    testValidation('multipleOf(0.01) - cents precision', IsNumber.multipleOf(0.01), [
        {value: 0, valid: true},
        {value: 0.01, valid: true},
        {value: 0.99, valid: true},
        {value: 1.00, valid: true},
        {value: 1.23, valid: true},
        {value: 99.99, valid: true},
        {value: 0.001, valid: false, issue: IsNumberErrors.multipleOfError},
        {value: 0.123, valid: false, issue: IsNumberErrors.multipleOfError},
    ]);

    testValidation('multipleOf(2.5)', IsNumber.multipleOf(2.5), [
        {value: 0, valid: true},
        {value: 2.5, valid: true},
        {value: 5, valid: true},
        {value: 7.5, valid: true},
        {value: -2.5, valid: true},
        {value: 1, valid: false, issue: IsNumberErrors.multipleOfError},
        {value: 3, valid: false, issue: IsNumberErrors.multipleOfError},
        {value: 6, valid: false, issue: IsNumberErrors.multipleOfError},
    ]);

    // Combined constraints: multipleOf with min/max
    testValidation('multipleOf(5).min(10)', IsNumber.multipleOf(5).min(10), [
        {value: 10, valid: true},
        {value: 15, valid: true},
        {value: 5, valid: false, issue: IsNumberErrors.minError},
        {value: 12, valid: false, issue: IsNumberErrors.multipleOfError},
    ]);

    testValidation('multipleOf(10).range(0, 100)', IsNumber.multipleOf(10).range(0, 100), [
        {value: 0, valid: true},
        {value: 50, valid: true},
        {value: 100, valid: true},
        {value: -10, valid: false, issue: IsNumberErrors.rangeError},
        {value: 110, valid: false, issue: IsNumberErrors.rangeError},
        {value: 55, valid: false, issue: IsNumberErrors.multipleOfError},
    ]);

    // Coercion with multipleOf - rounds to nearest multiple
    testCoercion('coercion + multipleOf(5)', IsNumber.multipleOf(5), [
        {value: '10', result: 10},
        {value: '5', result: 5},
        {value: '0', result: 0},
        {value: '12', result: 10},   // 12 -> 10 (nearest multiple)
        {value: '13', result: 15},   // 13 -> 15 (nearest multiple)
        {value: '7', result: 5},     // 7 -> 5 (nearest multiple)
        {value: '8', result: 10},    // 8 -> 10 (nearest multiple)
        {value: '-3', result: -5},   // -3 -> -5 (nearest multiple)
        {value: 'hello', result: undefined, issue: IsNumberErrors.typeError},
    ]);

    testCoercion('coercion + multipleOf(0.1)', IsNumber.multipleOf(0.1), [
        {value: '0.15', result: 0.2},  // 0.15 -> 0.2
        {value: '0.14', result: 0.1},  // 0.14 -> 0.1
        {value: '0.33', result: 0.3},  // 0.33 -> 0.3
        {value: '0.37', result: 0.4},  // 0.37 -> 0.4
    ]);

    testCoercion('coercion + multipleOf(0.01)', IsNumber.multipleOf(0.01), [
        {value: '1.234', result: 1.23},   // 1.234 -> 1.23
        {value: '1.235', result: 1.24},   // 1.235 -> 1.24 (rounding)
        {value: '99.999', result: 100},   // 99.999 -> 100
    ]);

    // Coercion with multipleOf + range - rounds then validates
    testCoercion('coercion + multipleOf(5).max(100)', IsNumber.multipleOf(5).max(100), [
        {value: '97', result: 95},      // 97 -> 95 (rounds down, within range)
        {value: '98', result: 100},     // 98 -> 100 (rounds up, at boundary)
        {value: '103', result: undefined, issue: IsNumberErrors.maxError},  // 103 -> 105 (exceeds max)
    ]);

    describe('multipleOf constraints', () => {
        it('throws for non-positive multipleOf', () => {
            expect(() => IsNumber.multipleOf(0)).toThrow('multipleOf must be positive');
            expect(() => IsNumber.multipleOf(-5)).toThrow('multipleOf must be positive');
        });
    });

    // Floating point edge cases - known IEEE 754 precision issues
    describe('multipleOf floating point edge cases', () => {
        const schema01 = IsNumber.multipleOf(0.1);
        const schema001 = IsNumber.multipleOf(0.01);

        describe('validation - values that would fail naive modulo', () => {
            // 0.3 % 0.1 = 0.09999999999999998 (not 0)
            it('0.3 is a valid multiple of 0.1', () => {
                expect(schema01.is(0.3)).toBe(true);
            });

            // 0.6 % 0.1 = 0.09999999999999998
            it('0.6 is a valid multiple of 0.1', () => {
                expect(schema01.is(0.6)).toBe(true);
            });

            // 0.7 % 0.1 = 0.09999999999999992
            it('0.7 is a valid multiple of 0.1', () => {
                expect(schema01.is(0.7)).toBe(true);
            });

            // 0.1 + 0.2 = 0.30000000000000004
            it('0.1 + 0.2 result is valid multiple of 0.1', () => {
                expect(schema01.is(0.1 + 0.2)).toBe(true);
            });

            // 0.1 * 3 = 0.30000000000000004
            it('0.1 * 3 result is valid multiple of 0.1', () => {
                expect(schema01.is(0.1 * 3)).toBe(true);
            });

            // 1.1 + 1.3 = 2.4000000000000004
            it('1.1 + 1.3 result is valid multiple of 0.1', () => {
                expect(schema01.is(1.1 + 1.3)).toBe(true);
            });

            // 0.01 * 33 = 0.32999999999999996
            it('0.01 * 33 result is valid multiple of 0.01', () => {
                expect(schema001.is(0.01 * 33)).toBe(true);
            });

            // 1.005 in IEEE 754 is actually 1.0049999999999999 - NOT a multiple of 0.01
            // This is a known floating point representation issue
            it('1.005 literal is NOT exactly a multiple of 0.01 (IEEE 754 representation)', () => {
                // 1.005 cannot be exactly represented, it's stored as ~1.00499999999999989
                expect(schema001.is(1.005)).toBe(false);
                expect(schema01.is(1.005)).toBe(false);
            });

            // Very small precision test
            it('99.99 is valid multiple of 0.01', () => {
                expect(schema001.is(99.99)).toBe(true);
            });

            // Accumulated error from multiple additions
            it('accumulated 0.1 additions equal to 1.0', () => {
                let sum = 0;
                for (let i = 0; i < 10; i++) sum += 0.1;
                // sum = 0.9999999999999999, not 1.0
                expect(schema01.is(sum)).toBe(true);
            });
        });

        describe('coercion - rounding edge cases', () => {
            // 0.15 / 0.1 = 1.4999999999999998 (should round to 2, not 1)
            it('0.15 rounds to 0.2 (not 0.1)', () => {
                const issues = new GGIssuesList();
                expect(schema01._parse(0.15, issues, '', true)).toBe(0.2);
            });

            // 0.25 / 0.1 = 2.4999999999999996
            it('0.25 rounds to 0.3 (JS rounds .5 away from zero)', () => {
                const issues = new GGIssuesList();
                const result = schema01._parse(0.25, issues, '', true);
                // Math.round(2.5) = 3 in JS, so we get 0.3
                expect(result).toBe(0.3);
            });

            // 0.35 / 0.1 = 3.4999999999999996
            it('0.35 rounds to 0.4 (not 0.3)', () => {
                const issues = new GGIssuesList();
                expect(schema01._parse(0.35, issues, '', true)).toBe(0.4);
            });

            // 0.45 / 0.1 = 4.499999999999999
            it('0.45 rounds to 0.5 (not 0.4)', () => {
                const issues = new GGIssuesList();
                expect(schema01._parse(0.45, issues, '', true)).toBe(0.5);
            });

            // Result should be clean, not 0.30000000000000004
            it('coercion result is clean (no floating point artifacts)', () => {
                const issues = new GGIssuesList();
                const result = schema01._parse(0.33, issues, '', true);
                expect(result).toBe(0.3);
                expect(String(result)).toBe('0.3'); // String check for clean value
            });

            // 1.005 in IEEE 754 is ~100.49999999999999 when divided by 0.01
            // Our epsilon correction pushes it to round up (expected business behavior)
            it('1.005 rounds to 1.01 (epsilon correction for .5 cases)', () => {
                const issues = new GGIssuesList();
                // This is the infamous "bankers rounding" edge case
                // With epsilon correction, we round up which is what most people expect
                expect(schema001._parse(1.005, issues, '', true)).toBe(1.01);
            });

            // 2.675 / 0.01 = 267.5 (exactly), rounds to 268 → 2.68
            it('2.675 rounds to 2.68 (exactly .5, rounds away from zero)', () => {
                const issues = new GGIssuesList();
                expect(schema001._parse(2.675, issues, '', true)).toBe(2.68);
            });

            // Large number with decimal
            it('large number 123456.789 rounds to 0.01', () => {
                const issues = new GGIssuesList();
                expect(schema001._parse(123456.789, issues, '', true)).toBe(123456.79);
            });

            // Negative edge cases
            it('-0.15 rounds to -0.2', () => {
                const issues = new GGIssuesList();
                expect(schema01._parse(-0.15, issues, '', true)).toBe(-0.2);
            });

            it('-0.35 rounds to -0.4', () => {
                const issues = new GGIssuesList();
                expect(schema01._parse(-0.35, issues, '', true)).toBe(-0.4);
            });

            // Values that CAN be exactly represented round correctly
            it('0.5 rounds to 0.5 (exactly representable)', () => {
                const issues = new GGIssuesList();
                expect(schema01._parse(0.5, issues, '', true)).toBe(0.5);
            });

            it('0.25 rounds to 0.25 with multipleOf(0.01)', () => {
                const issues = new GGIssuesList();
                expect(schema001._parse(0.25, issues, '', true)).toBe(0.25);
            });

            it('0.125 rounds to 0.12 with multipleOf(0.01)', () => {
                const issues = new GGIssuesList();
                // 0.125 is exactly representable (1/8), rounds to 0.12 or 0.13
                // Math.round(12.5) = 13 in JS (rounds away from zero)
                expect(schema001._parse(0.125, issues, '', true)).toBe(0.13);
            });
        });

        describe('very small and very large multipleOf values', () => {
            it('handles multipleOf(0.001) correctly', () => {
                const schema = IsNumber.multipleOf(0.001);
                expect(schema.is(0.001)).toBe(true);
                expect(schema.is(0.123)).toBe(true);
                expect(schema.is(1.234)).toBe(true);
                expect(schema.is(0.0001)).toBe(false);
            });

            it('handles multipleOf(1000) correctly', () => {
                const schema = IsNumber.multipleOf(1000);
                expect(schema.is(0)).toBe(true);
                expect(schema.is(1000)).toBe(true);
                expect(schema.is(5000)).toBe(true);
                expect(schema.is(500)).toBe(false);
                expect(schema.is(1500)).toBe(false);
            });

            it('handles multipleOf(0.25) - quarter precision', () => {
                const schema = IsNumber.multipleOf(0.25);
                expect(schema.is(0)).toBe(true);
                expect(schema.is(0.25)).toBe(true);
                expect(schema.is(0.5)).toBe(true);
                expect(schema.is(0.75)).toBe(true);
                expect(schema.is(1.0)).toBe(true);
                expect(schema.is(0.3)).toBe(false);
                expect(schema.is(0.1)).toBe(false);
            });

            it('handles multipleOf(Math.PI) - irrational base', () => {
                const schema = IsNumber.multipleOf(Math.PI);
                expect(schema.is(0)).toBe(true);
                expect(schema.is(Math.PI)).toBe(true);
                expect(schema.is(Math.PI * 2)).toBe(true);
                expect(schema.is(Math.PI * 10)).toBe(true);
                expect(schema.is(3)).toBe(false);
            });
        });
    });

    // ==================== toSchemaDescription ====================

    describe('toSchemaDescription()', () => {
        it('float number', () => {
            const desc = IsNumber.toSchemaDescription();
            expect(desc.node).toEqual({kind: 'number', integer: false});
            expect(desc.nullable).toBe(false);
        });
        it('min/max', () => {
            const desc = IsNumber.min(0).max(100).toSchemaDescription();
            expect((desc.node as any).min).toBe(0);
            expect((desc.node as any).max).toBe(100);
            expect((desc.node as any).integer).toBe(false);
        });
        it('multipleOf', () => {
            const desc = IsNumber.multipleOf(5).toSchemaDescription();
            expect((desc.node as any).multipleOf).toBe(5);
        });
        it('multipleOf with min/max', () => {
            const desc = IsNumber.min(0).max(100).multipleOf(5).toSchemaDescription();
            expect((desc.node as any).min).toBe(0);
            expect((desc.node as any).max).toBe(100);
            expect((desc.node as any).multipleOf).toBe(5);
        });
        it('nullable', () => {
            const desc = IsNumber.orNull.toSchemaDescription();
            expect(desc.node).toEqual({kind: 'number', integer: false});
            expect(desc.nullable).toBe(true);
        });
        it('integer flag', () => {
            const intSchema = new NumberSchema({type: 'int', integer: true});
            const desc = intSchema.toSchemaDescription();
            expect(desc.node).toEqual({kind: 'number', integer: true});
        });
    });

    // ==================== Stringify ====================

    testStringify('stringify', IsNumber, [
        {value: 0, expected: 0},
        {value: 42, expected: 42},
        {value: -42, expected: -42},
        {value: 3.14, expected: 3.14},
        {value: -3.14, expected: -3.14},
    ]);

    testStringify('stringify orNull', IsNumber.orNull, [
        {value: 42, expected: 42},
        {value: null, expected: null},
    ]);

});
