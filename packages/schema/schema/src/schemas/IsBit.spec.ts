import {describe, expect, it} from 'vitest';
import {IsBit} from './IsBit';
import {GGIssueKey} from "../issue/GGIssueKey";
import {GGIssuesList} from "../issue/GGIssuesList";
import {testCoercion, testStringify, testValidation, testUtils} from "../utils/testUtils";
import {IsBitErrors} from "../Errors";

// Define test issues outside utilsSpec to avoid double registration
const mustBeOneError = new GGIssueKey('bit_must_be_one', 'Value must be 1');

testUtils('IsBit', () => {

    testValidation('validation', IsBit, [
        {value: 0, valid: true},
        {value: 1, valid: true},
        {value: 2, valid: false, issue: IsBitErrors.typeError},
        {value: -1, valid: false, issue: IsBitErrors.typeError},
        {value: 0.5, valid: false, issue: IsBitErrors.typeError},
        {value: 100, valid: false, issue: IsBitErrors.typeError},
        {value: '0', valid: false, issue: IsBitErrors.typeError},
        {value: '1', valid: false, issue: IsBitErrors.typeError},
        {value: true, valid: false, issue: IsBitErrors.typeError},
        {value: false, valid: false, issue: IsBitErrors.typeError},
        {value: {}, valid: false, issue: IsBitErrors.typeError},
        {value: [], valid: false, issue: IsBitErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);

    testCoercion('coercion', IsBit, [
        {value: true, result: 1},
        {value: false, result: 0},
        {value: 'true', result: 1},
        {value: 'false', result: 0},
        {value: '1', result: 1},
        {value: '0', result: 0},
        {value: 1, result: 1},
        {value: 0, result: 0},
        {value: '2', result: undefined, issue: IsBitErrors.typeError},
        {value: 2, result: undefined, issue: IsBitErrors.typeError},
        {value: {}, result: undefined, issue: IsBitErrors.typeError},
        // Case sensitivity - uppercase variants are NOT coerced
        {value: 'True', result: undefined, issue: IsBitErrors.typeError},
        {value: 'False', result: undefined, issue: IsBitErrors.typeError},
        {value: 'TRUE', result: undefined, issue: IsBitErrors.typeError},
        {value: 'FALSE', result: undefined, issue: IsBitErrors.typeError},
    ]);

    testValidation('orUndefined', IsBit.orUndefined, [
        {value: undefined, valid: true},
        {value: 0, valid: true},
        {value: 1, valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: 2, valid: false, issue: IsBitErrors.typeError},
    ]);

    testValidation('orNull', IsBit.orNull, [
        {value: null, valid: true},
        {value: 0, valid: true},
        {value: 1, valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: -1, valid: false, issue: IsBitErrors.typeError},
    ]);

    // ==================== Refinement ====================

    describe('refine()', () => {
        const IsOne = IsBit.refine(v => v === 1, mustBeOneError);

        it('accepts values passing refinement', () => {
            expect(IsOne.is(1)).toBe(true);
        });

        it('rejects values failing refinement', () => {
            expect(IsOne.is(0)).toBe(false);
        });

        it('adds correct error for failing refinement', () => {
            const issues = new GGIssuesList();
            expect(IsOne._parse(0, issues, 'test')).toBeUndefined();
            expect(issues.getIssue(0)).toBe(mustBeOneError);
        });
    });

    // ==================== Stringify ====================

    testStringify('stringify', IsBit, [
        {value: 0, expected: 0},
        {value: 1, expected: 1},
    ]);

    testStringify('stringify orNull', IsBit.orNull, [
        {value: 0, expected: 0},
        {value: 1, expected: 1},
        {value: null, expected: null},
    ]);

    // ==================== toJSONSchema ====================

    describe('toJSONSchema()', () => {
        it('basic', () => {
            expect(IsBit.toJSONSchema()).toEqual({type: 'integer', minimum: 0, maximum: 1});
        });
        it('nullable', () => {
            expect(IsBit.orNull.toJSONSchema())
                .toEqual({oneOf: [{type: 'integer', minimum: 0, maximum: 1}, {type: 'null'}]});
        });
    });

});
