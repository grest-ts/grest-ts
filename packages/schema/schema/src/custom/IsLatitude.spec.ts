import {IsLatitude} from './IsLatitude';
import {GGIssueKey} from "../issue/GGIssueKey";
import {testCoercion, testValidation, testUtils} from "../utils/testUtils";
import {IsNumberErrors} from "../Errors";


testUtils('IsLatitude', () => {

    testValidation('validation', IsLatitude, [
        // Valid range (-90 to 90)
        {value: 0, valid: true},
        {value: 45.5, valid: true},
        {value: -45.5, valid: true},
        {value: 90, valid: true},
        {value: -90, valid: true},
        // Cities
        {value: 59.437, valid: true},    // Tallinn
        {value: 51.5074, valid: true},   // London
        {value: -33.8688, valid: true},  // Sydney
        {value: 40.7128, valid: true},   // New York
        // Out of range
        {value: 90.1, valid: false, issue: IsNumberErrors.rangeError},
        {value: -90.1, valid: false, issue: IsNumberErrors.rangeError},
        {value: 100, valid: false, issue: IsNumberErrors.rangeError},
        {value: -100, valid: false, issue: IsNumberErrors.rangeError},
        {value: 180, valid: false, issue: IsNumberErrors.rangeError},
        // Special values (NaN and Infinity fail type check)
        {value: NaN, valid: false, issue: IsNumberErrors.typeError},
        {value: Infinity, valid: false, issue: IsNumberErrors.typeError},
        {value: -Infinity, valid: false, issue: IsNumberErrors.typeError},
        // Non-numbers
        {value: '45.5', valid: false, issue: IsNumberErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: {}, valid: false, issue: IsNumberErrors.typeError},
    ]);

    testCoercion('coercion', IsLatitude, [
        {value: '45.5', result: 45.5},
        {value: '-90', result: -90},
        {value: '100', result: undefined, issue: IsNumberErrors.rangeError},
    ]);

    testValidation('orUndefined', IsLatitude.orUndefined, [
        {value: undefined, valid: true},
        {value: 45.5, valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('orNull', IsLatitude.orNull, [
        {value: null, valid: true},
        {value: 45.5, valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);
});
