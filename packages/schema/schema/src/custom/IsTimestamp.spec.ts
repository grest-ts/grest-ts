import {IsTimestamp, IsTimestampMs} from './IsTimestamp';
import {GGIssueKey} from "../issue/GGIssueKey";
import {testCoercion, testValidation, testUtils} from "../utils/testUtils";
import {IsNumberErrors} from "../Errors";

testUtils('IsTimestamp', () => {

    testValidation('validation', IsTimestamp, [
        // Valid timestamps (seconds)
        {value: 0, valid: true},
        {value: 1704067200, valid: true},    // 2024-01-01
        {value: 1609459200, valid: true},    // 2021-01-01
        {value: 32503680000, valid: true},   // year 3000
        // Invalid - negative
        {value: -1, valid: false, issue: IsNumberErrors.rangeError},
        {value: -30610224000, valid: false, issue: IsNumberErrors.rangeError},
        // Invalid - beyond year 3000
        {value: 32503680001, valid: false, issue: IsNumberErrors.rangeError},
        // Invalid - floats
        {value: 1704067200.5, valid: false, issue: IsNumberErrors.integerError},
        {value: 1704067200.123, valid: false, issue: IsNumberErrors.integerError},
        // Special values (NaN and Infinity fail type check)
        {value: NaN, valid: false, issue: IsNumberErrors.typeError},
        {value: Infinity, valid: false, issue: IsNumberErrors.typeError},
        {value: -Infinity, valid: false, issue: IsNumberErrors.typeError},
        // Non-numbers
        {value: '1704067200', valid: false, issue: IsNumberErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: {}, valid: false, issue: IsNumberErrors.typeError},
    ]);

    testCoercion('coercion', IsTimestamp, [
        {value: '1704067200', result: 1704067200},
        {value: '0', result: 0},
    ]);

    testValidation('orUndefined', IsTimestamp.orUndefined, [
        {value: undefined, valid: true},
        {value: 1704067200, valid: true},
    ]);

    testValidation('orNull', IsTimestamp.orNull, [
        {value: null, valid: true},
        {value: 1704067200, valid: true},
    ]);
});

testUtils('IsTimestampMs', () => {

    testValidation('validation', IsTimestampMs, [
        // Valid timestamps (milliseconds)
        {value: 0, valid: true},
        {value: 1704067200000, valid: true},    // 2024-01-01
        {value: 1609459200000, valid: true},    // 2021-01-01
        {value: 32503680000000, valid: true},   // year 3000
        // Invalid - negative
        {value: -1, valid: false, issue: IsNumberErrors.rangeError},
        {value: -1704067200000, valid: false, issue: IsNumberErrors.rangeError},
        // Invalid - beyond year 3000
        {value: 32503680000001, valid: false, issue: IsNumberErrors.rangeError},
        // Invalid - floats
        {value: 1704067200000.5, valid: false, issue: IsNumberErrors.integerError},
        // Special values (NaN and Infinity fail type check)
        {value: NaN, valid: false, issue: IsNumberErrors.typeError},
        {value: Infinity, valid: false, issue: IsNumberErrors.typeError},
        // Non-numbers
        {value: '1704067200000', valid: false, issue: IsNumberErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);

    testCoercion('coercion', IsTimestampMs, [
        {value: '1704067200000', result: 1704067200000},
        {value: '0', result: 0},
    ]);

    testValidation('orUndefined', IsTimestampMs.orUndefined, [
        {value: undefined, valid: true},
        {value: 1704067200000, valid: true},
    ]);

    testValidation('orNull', IsTimestampMs.orNull, [
        {value: null, valid: true},
        {value: 1704067200000, valid: true},
    ]);
});
