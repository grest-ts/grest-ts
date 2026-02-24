import {IsDateTime} from './IsDateTime';
import {GGIssueKey} from "../issue/GGIssueKey";
import {testStringify, testValidation, testUtils} from "../utils/testUtils";
import {IsStringErrors} from "../Errors";


testUtils('IsDateTime', () => {

    testStringify('stringify', IsDateTime, [
        {value: '2024-01-15 14:30:00', expected: '2024-01-15 14:30:00'},
        {value: '2000-12-31 23:59:59', expected: '2000-12-31 23:59:59'},
    ]);

    testValidation('validation', IsDateTime, [
        // Valid YYYY-MM-DD HH:mm:ss
        {value: '2024-01-15 14:30:00', valid: true},
        {value: '2024-12-31 23:59:59', valid: true},
        {value: '2000-01-01 00:00:00', valid: true},
        // Leap year
        {value: '2024-02-29 12:00:00', valid: true},
        {value: '2000-02-29 00:00:00', valid: true},
        // Invalid leap year
        {value: '2023-02-29 12:00:00', valid: false, issue: IsDateTime.invalidError},
        // Invalid date parts (pass regex, fail validation)
        {value: '2024-13-15 12:00:00', valid: false, issue: IsDateTime.invalidError},
        {value: '2024-01-32 12:00:00', valid: false, issue: IsDateTime.invalidError},
        {value: '2024-04-31 12:00:00', valid: false, issue: IsDateTime.invalidError},
        // Invalid time parts (pass regex, fail validation)
        {value: '2024-01-15 25:00:00', valid: false, issue: IsDateTime.invalidError},
        {value: '2024-01-15 12:60:00', valid: false, issue: IsDateTime.invalidError},
        {value: '2024-01-15 12:30:60', valid: false, issue: IsDateTime.invalidError},
        // Wrong format
        {value: '2024-01-15T14:30:00', valid: false, issue: IsDateTime.formatError},
        {value: '2024/01/15 14:30:00', valid: false, issue: IsDateTime.formatError},
        {value: '01-15-2024 14:30:00', valid: false, issue: IsDateTime.formatError},
        {value: '2024-01-15 2:30:00 PM', valid: false, issue: IsDateTime.formatError},
        // Extra spaces
        {value: '2024-01-15  14:30:00', valid: false, issue: IsDateTime.formatError},
        {value: ' 2024-01-15 14:30:00', valid: false, issue: IsDateTime.formatError},
        {value: '2024-01-15 14:30:00 ', valid: false, issue: IsDateTime.formatError},
        // Incomplete
        {value: '2024-01-15', valid: false, issue: IsDateTime.formatError},
        {value: '14:30:00', valid: false, issue: IsDateTime.formatError},
        {value: '2024-01-15 14:30', valid: false, issue: IsDateTime.formatError},
        // Incorrect padding
        {value: '2024-1-15 14:30:00', valid: false, issue: IsDateTime.formatError},
        {value: '2024-01-15 4:30:00', valid: false, issue: IsDateTime.formatError},
        // Empty string
        {value: '', valid: false, issue: IsDateTime.formatError},
        // Non-string values
        {value: 20240115143000, valid: false, issue: IsStringErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: new Date(), valid: false, issue: IsStringErrors.typeError},
        {value: {}, valid: false, issue: IsStringErrors.typeError},
    ]);

    testValidation('orUndefined', IsDateTime.orUndefined, [
        {value: undefined, valid: true},
        {value: '2024-01-15 14:30:00', valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('orNull', IsDateTime.orNull, [
        {value: null, valid: true},
        {value: '2024-01-15 14:30:00', valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);
});
