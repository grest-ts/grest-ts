import {describe, expect, it} from 'vitest';
import {IsUnknown} from './IsUnknown';
import {GGIssueKey} from "../issue/GGIssueKey";
import {GGIssuesList} from "../issue/GGIssuesList";
import {testStringify, testValidation, testUtils} from "../utils/testUtils";

// Define test issues outside utilsSpec to avoid double registration
const mustBeNumberError = new GGIssueKey('unknown_must_be_number', 'Value must be a number');

testUtils('IsUnknown', () => {

    testValidation('validation', IsUnknown, [
        {value: 'string', valid: true},
        {value: '', valid: true},
        {value: 123, valid: true},
        {value: 0, valid: true},
        {value: -1, valid: true},
        {value: 3.14, valid: true},
        {value: NaN, valid: true},
        {value: Infinity, valid: true},
        {value: true, valid: true},
        {value: false, valid: true},
        {value: {}, valid: true},
        {value: {a: 1}, valid: true},
        {value: [], valid: true},
        {value: [1, 2, 3], valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('orUndefined', IsUnknown.orUndefined, [
        {value: undefined, valid: true},
        {value: 'anything', valid: true},
        {value: 123, valid: true},
        {value: {}, valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('orNull', IsUnknown.orNull, [
        {value: null, valid: true},
        {value: 'anything', valid: true},
        {value: 123, valid: true},
        {value: {}, valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);

    // Special values
    describe('special values', () => {
        it('should accept Symbol', () => {
            expect(IsUnknown.is(Symbol())).toBe(true);
        });

        it('should accept functions', () => {
            expect(IsUnknown.is(() => {})).toBe(true);
        });

        it('should preserve reference in parse', () => {
            const obj = {a: 1};
            const issues = new GGIssuesList();
            expect(IsUnknown._parse(obj, issues, 'test')).toBe(obj);
        });
    });

    // Document the difference from IsAny (type-level only)
    describe('vs IsAny', () => {
        it('should behave the same as IsAny at runtime', () => {
            // IsUnknown and IsAny behave identically at runtime
            // The difference is TypeScript type inference:
            // - IsAny.infer -> any
            // - IsUnknown.infer -> unknown
            expect(IsUnknown.is('test')).toBe(true);
            expect(IsUnknown.is(null)).toBe(false);
            expect(IsUnknown.is(undefined)).toBe(false);
        });
    });

    // ==================== Refinement ====================

    describe('refine()', () => {
        const IsUnknownNumber = IsUnknown.refine(v => typeof v === 'number' && !isNaN(v as number), mustBeNumberError);

        it('accepts values passing refinement', () => {
            expect(IsUnknownNumber.is(42)).toBe(true);
            expect(IsUnknownNumber.is(0)).toBe(true);
            expect(IsUnknownNumber.is(-3.14)).toBe(true);
        });

        it('rejects values failing refinement', () => {
            expect(IsUnknownNumber.is('hello')).toBe(false);
            expect(IsUnknownNumber.is(NaN)).toBe(false);
            expect(IsUnknownNumber.is({})).toBe(false);
        });

        it('adds correct error for failing refinement', () => {
            const issues = new GGIssuesList();
            expect(IsUnknownNumber._parse('not a number', issues, 'test')).toBeUndefined();
            expect(issues.getIssue(0)).toBe(mustBeNumberError);
        });
    });

    // ==================== Stringify ====================

    testStringify('stringify primitives', IsUnknown, [
        {value: 'hello', expected: 'hello'},
        {value: 42, expected: 42},
        {value: true, expected: true},
        {value: false, expected: false},
    ]);

    testStringify('stringify objects', IsUnknown, [
        {value: {a: 1, b: 2}, expected: {a: 1, b: 2}},
        {value: {}, expected: {}},
    ]);

    testStringify('stringify arrays', IsUnknown, [
        {value: [1, 2, 3], expected: [1, 2, 3]},
        {value: [], expected: []},
    ]);

    testStringify('stringify orNull', IsUnknown.orNull, [
        {value: 'hello', expected: 'hello'},
        {value: null, expected: null},
    ]);

});
