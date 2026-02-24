import {describe, expect, it} from 'vitest';
import {IsAny} from './IsAny';
import {GGIssueKey} from "../issue/GGIssueKey";
import {GGIssuesList} from "../issue/GGIssuesList";
import {testStringify, testValidation, testUtils} from "../utils/testUtils";

// Define test issues outside utilsSpec to avoid double registration
const mustBeStringError = new GGIssueKey('any_must_be_string', 'Value must be a string');

testUtils('IsAny', () => {

    testValidation('validation', IsAny, [
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

    testValidation('orUndefined', IsAny.orUndefined, [
        {value: undefined, valid: true},
        {value: 'anything', valid: true},
        {value: 123, valid: true},
        {value: {}, valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('orNull', IsAny.orNull, [
        {value: null, valid: true},
        {value: 'anything', valid: true},
        {value: 123, valid: true},
        {value: {}, valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);

    // Special values
    describe('special values', () => {
        it('should accept Symbol', () => {
            expect(IsAny.is(Symbol())).toBe(true);
        });

        it('should accept functions', () => {
            expect(IsAny.is(() => {})).toBe(true);
        });

        it('should preserve reference in parse', () => {
            const obj = {a: 1};
            const issues = new GGIssuesList();
            expect(IsAny._parse(obj, issues, 'test')).toBe(obj);
        });
    });

    // ==================== Refinement ====================

    describe('refine()', () => {
        const IsAnyString = IsAny.refine(v => typeof v === 'string', mustBeStringError);

        it('accepts values passing refinement', () => {
            expect(IsAnyString.is('hello')).toBe(true);
            expect(IsAnyString.is('')).toBe(true);
        });

        it('rejects values failing refinement', () => {
            expect(IsAnyString.is(123)).toBe(false);
            expect(IsAnyString.is({})).toBe(false);
            expect(IsAnyString.is([])).toBe(false);
        });

        it('adds correct error for failing refinement', () => {
            const issues = new GGIssuesList();
            expect(IsAnyString._parse(123, issues, 'test')).toBeUndefined();
            expect(issues.getIssue(0)).toBe(mustBeStringError);
        });
    });

    // ==================== Stringify ====================

    testStringify('stringify primitives', IsAny, [
        {value: 'hello', expected: 'hello'},
        {value: 42, expected: 42},
        {value: true, expected: true},
        {value: false, expected: false},
    ]);

    testStringify('stringify objects', IsAny, [
        {value: {a: 1, b: 2}, expected: {a: 1, b: 2}},
        {value: {}, expected: {}},
    ]);

    testStringify('stringify arrays', IsAny, [
        {value: [1, 2, 3], expected: [1, 2, 3]},
        {value: [], expected: []},
    ]);

    testStringify('stringify orNull', IsAny.orNull, [
        {value: 'hello', expected: 'hello'},
        {value: null, expected: null},
    ]);

});
