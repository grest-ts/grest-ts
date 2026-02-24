import {IsDate} from './IsDate';
import {GGIssueKey} from "../issue/GGIssueKey";
import {testStringify, testValidation, testUtils} from "../utils/testUtils";
import {IsStringErrors} from "../Errors";


testUtils('IsDate', () => {

    testStringify('stringify', IsDate, [
        {value: '2024-01-15', expected: '2024-01-15'},
        {value: '2000-12-31', expected: '2000-12-31'},
    ]);

    testValidation('validation', IsDate, [
        // Valid YYYY-MM-DD dates
        {value: '2024-01-15', valid: true},
        {value: '2024-12-31', valid: true},
        {value: '2000-01-01', valid: true},
        {value: '1999-06-15', valid: true},
        // Leap year dates
        {value: '2024-02-29', valid: true},
        {value: '2000-02-29', valid: true},
        // Month boundaries
        {value: '2024-01-31', valid: true},
        {value: '2024-04-30', valid: true},
        {value: '2024-02-28', valid: true},
        // Invalid leap years
        {value: '2023-02-29', valid: false, issue: IsDate.invalidError},
        {value: '1900-02-29', valid: false, issue: IsDate.invalidError},
        // Invalid days for month
        {value: '2024-04-31', valid: false, issue: IsDate.invalidError},
        {value: '2024-06-31', valid: false, issue: IsDate.invalidError},
        {value: '2024-02-30', valid: false, issue: IsDate.invalidError},
        // Invalid month values (pass regex, fail date validation)
        {value: '2024-00-15', valid: false, issue: IsDate.invalidError},
        {value: '2024-13-15', valid: false, issue: IsDate.invalidError},
        // Invalid day values (pass regex, fail date validation)
        {value: '2024-01-00', valid: false, issue: IsDate.invalidError},
        {value: '2024-01-32', valid: false, issue: IsDate.invalidError},
        // Wrong format
        {value: '01-15-2024', valid: false, issue: IsDate.formatError},
        {value: '15-01-2024', valid: false, issue: IsDate.formatError},
        {value: '2024/01/15', valid: false, issue: IsDate.formatError},
        {value: '2024.01.15', valid: false, issue: IsDate.formatError},
        {value: '20240115', valid: false, issue: IsDate.formatError},
        // Spaces
        {value: '2024-01-15 ', valid: false, issue: IsDate.formatError},
        {value: ' 2024-01-15', valid: false, issue: IsDate.formatError},
        // Missing parts
        {value: '2024-01', valid: false, issue: IsDate.formatError},
        {value: '2024', valid: false, issue: IsDate.formatError},
        // Incorrect padding
        {value: '2024-1-15', valid: false, issue: IsDate.formatError},
        {value: '2024-01-5', valid: false, issue: IsDate.formatError},
        // Empty string
        {value: '', valid: false, issue: IsDate.formatError},
        // Non-string values
        {value: 20240115, valid: false, issue: IsStringErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: new Date(), valid: false, issue: IsStringErrors.typeError},
        {value: {}, valid: false, issue: IsStringErrors.typeError},
    ]);

    testValidation('orUndefined', IsDate.orUndefined, [
        {value: undefined, valid: true},
        {value: '2024-01-15', valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('orNull', IsDate.orNull, [
        {value: null, valid: true},
        {value: '2024-01-15', valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);
});
