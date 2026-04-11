import {describe, expect, it} from 'vitest';
import {IsBoolean} from './IsBoolean';
import {GGIssueKey} from "../issue/GGIssueKey";
import {GGIssuesList} from "../issue/GGIssuesList";
import {testCoercion, testStringify, testValidation, testUtils} from "../utils/testUtils";
import {IsBooleanErrors} from "../Errors";

// Define test issues outside utilsSpec to avoid double registration
const mustBeTrueError = new GGIssueKey('bool_must_be_true', 'Value must be true');

testUtils('IsBoolean', () => {

    testValidation('validation', IsBoolean, [
        {value: true, valid: true},
        {value: false, valid: true},
        {value: 'true', valid: false, issue: IsBooleanErrors.typeError},
        {value: 'false', valid: false, issue: IsBooleanErrors.typeError},
        {value: 1, valid: false, issue: IsBooleanErrors.typeError},
        {value: 0, valid: false, issue: IsBooleanErrors.typeError},
        {value: '', valid: false, issue: IsBooleanErrors.typeError},
        {value: {}, valid: false, issue: IsBooleanErrors.typeError},
        {value: [], valid: false, issue: IsBooleanErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);

    testCoercion('coercion', IsBoolean, [
        {value: 'true', result: true},
        {value: 'false', result: false},
        {value: '1', result: true},
        {value: '0', result: false},
        {value: 1, result: true},
        {value: 0, result: false},
        {value: 'yes', result: undefined, issue: IsBooleanErrors.typeError},
        {value: 'no', result: undefined, issue: IsBooleanErrors.typeError},
        {value: 2, result: undefined, issue: IsBooleanErrors.typeError},
        {value: {}, result: undefined, issue: IsBooleanErrors.typeError},
        // Case sensitivity - uppercase variants are NOT coerced
        {value: 'True', result: undefined, issue: IsBooleanErrors.typeError},
        {value: 'False', result: undefined, issue: IsBooleanErrors.typeError},
        {value: 'TRUE', result: undefined, issue: IsBooleanErrors.typeError},
        {value: 'FALSE', result: undefined, issue: IsBooleanErrors.typeError},
    ]);

    testValidation('orUndefined', IsBoolean.orUndefined, [
        {value: undefined, valid: true},
        {value: true, valid: true},
        {value: false, valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: 'true', valid: false, issue: IsBooleanErrors.typeError},
    ]);

    testValidation('orNull', IsBoolean.orNull, [
        {value: null, valid: true},
        {value: true, valid: true},
        {value: false, valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: 'false', valid: false, issue: IsBooleanErrors.typeError},
    ]);

    // ==================== Refinement ====================

    describe('refine()', () => {
        const IsTrue = IsBoolean.refine(v => v === true, mustBeTrueError);

        it('accepts values passing refinement', () => {
            expect(IsTrue.is(true)).toBe(true);
        });

        it('rejects values failing refinement', () => {
            expect(IsTrue.is(false)).toBe(false);
        });

        it('adds correct error for failing refinement', () => {
            const issues = new GGIssuesList();
            expect(IsTrue._parse(false, issues, 'test')).toBeUndefined();
            expect(issues.getIssue(0)).toBe(mustBeTrueError);
        });
    });

    // ==================== Stringify ====================

    testStringify('stringify', IsBoolean, [
        {value: true, expected: true},
        {value: false, expected: false},
    ]);

    testStringify('stringify orNull', IsBoolean.orNull, [
        {value: true, expected: true},
        {value: false, expected: false},
        {value: null, expected: null},
    ]);

    // ==================== toJSONSchema ====================

    describe('toJSONSchema()', () => {
        it('basic', () => {
            expect(IsBoolean.toJSONSchema()).toEqual({type: 'boolean'});
        });
        it('nullable', () => {
            expect(IsBoolean.orNull.toJSONSchema()).toEqual({oneOf: [{type: 'boolean'}, {type: 'null'}]});
        });
    });

});
