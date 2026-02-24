import {IsPercentage} from './IsPercentage';
import {GGIssueKey} from "../issue/GGIssueKey";
import {testCoercion, testValidation, testUtils} from "../utils/testUtils";
import {IsNumberErrors} from "../Errors";


testUtils('IsPercentage', () => {

    testValidation('validation', IsPercentage, [
        // Valid range (0 to 100)
        {value: 0, valid: true},
        {value: 50, valid: true},
        {value: 100, valid: true},
        // Decimals
        {value: 25.5, valid: true},
        {value: 99.99, valid: true},
        {value: 0.01, valid: true},
        {value: 33.33, valid: true},
        // Out of range
        {value: -1, valid: false, issue: IsNumberErrors.rangeError},
        {value: -0.01, valid: false, issue: IsNumberErrors.rangeError},
        {value: 100.01, valid: false, issue: IsNumberErrors.rangeError},
        {value: 101, valid: false, issue: IsNumberErrors.rangeError},
        {value: 200, valid: false, issue: IsNumberErrors.rangeError},
        // Special values (NaN and Infinity fail type check)
        {value: NaN, valid: false, issue: IsNumberErrors.typeError},
        {value: Infinity, valid: false, issue: IsNumberErrors.typeError},
        {value: -Infinity, valid: false, issue: IsNumberErrors.typeError},
        // Non-numbers
        {value: '50', valid: false, issue: IsNumberErrors.typeError},
        {value: '50%', valid: false, issue: IsNumberErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: {}, valid: false, issue: IsNumberErrors.typeError},
    ]);

    testCoercion('coercion', IsPercentage, [
        {value: '50', result: 50},
        {value: '0', result: 0},
        {value: '100', result: 100},
        {value: '101', result: undefined, issue: IsNumberErrors.rangeError},
    ]);

    testValidation('orUndefined', IsPercentage.orUndefined, [
        {value: undefined, valid: true},
        {value: 50, valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('orNull', IsPercentage.orNull, [
        {value: null, valid: true},
        {value: 50, valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);
});
