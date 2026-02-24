import {IsLongitude} from './IsLongitude';
import {GGIssueKey} from "../issue/GGIssueKey";
import {testCoercion, testValidation, testUtils} from "../utils/testUtils";
import {IsNumberErrors} from "../Errors";

testUtils('IsLongitude', () => {

    testValidation('validation', IsLongitude, [
        // Valid range (-180 to 180)
        {value: 0, valid: true},
        {value: 90, valid: true},
        {value: -90, valid: true},
        {value: 180, valid: true},
        {value: -180, valid: true},
        // Cities
        {value: 24.754, valid: true},    // Tallinn
        {value: -0.1278, valid: true},   // London
        {value: 151.2093, valid: true},  // Sydney
        {value: -74.006, valid: true},   // New York
        {value: 139.6917, valid: true},  // Tokyo
        // Out of range
        {value: 180.1, valid: false, issue: IsNumberErrors.rangeError},
        {value: -180.1, valid: false, issue: IsNumberErrors.rangeError},
        {value: 200, valid: false, issue: IsNumberErrors.rangeError},
        {value: -200, valid: false, issue: IsNumberErrors.rangeError},
        {value: 360, valid: false, issue: IsNumberErrors.rangeError},
        // Special values (NaN and Infinity fail type check)
        {value: NaN, valid: false, issue: IsNumberErrors.typeError},
        {value: Infinity, valid: false, issue: IsNumberErrors.typeError},
        {value: -Infinity, valid: false, issue: IsNumberErrors.typeError},
        // Non-numbers
        {value: '90.5', valid: false, issue: IsNumberErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: {}, valid: false, issue: IsNumberErrors.typeError},
    ]);

    testCoercion('coercion', IsLongitude, [
        {value: '90.5', result: 90.5},
        {value: '-180', result: -180},
        {value: '200', result: undefined, issue: IsNumberErrors.rangeError},
    ]);

    testValidation('orUndefined', IsLongitude.orUndefined, [
        {value: undefined, valid: true},
        {value: 90.5, valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('orNull', IsLongitude.orNull, [
        {value: null, valid: true},
        {value: 90.5, valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);
});
