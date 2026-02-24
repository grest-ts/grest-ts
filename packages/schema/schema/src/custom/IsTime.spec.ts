import {IsTime} from './IsTime';
import {GGIssueKey} from "../issue/GGIssueKey";
import {testStringify, testValidation, testUtils} from "../utils/testUtils";
import {IsStringErrors} from "../Errors";


testUtils('IsTime', () => {

    testStringify('stringify', IsTime, [
        {value: '14:30:00', expected: '14:30:00'},
        {value: '00:00:00', expected: '00:00:00'},
    ]);

    testValidation('validation', IsTime, [
        // Valid HH:mm:ss times
        {value: '00:00:00', valid: true},
        {value: '12:30:45', valid: true},
        {value: '23:59:59', valid: true},
        {value: '14:30:00', valid: true},
        {value: '06:30:00', valid: true},
        {value: '09:15:30', valid: true},
        {value: '18:45:15', valid: true},
        {value: '21:00:00', valid: true},
        // Invalid hours
        {value: '24:00:00', valid: false, issue: IsTime.timeError},
        {value: '25:00:00', valid: false, issue: IsTime.timeError},
        {value: '99:00:00', valid: false, issue: IsTime.timeError},
        // Invalid minutes
        {value: '12:60:00', valid: false, issue: IsTime.timeError},
        {value: '12:99:00', valid: false, issue: IsTime.timeError},
        // Invalid seconds
        {value: '12:30:60', valid: false, issue: IsTime.timeError},
        {value: '12:30:99', valid: false, issue: IsTime.timeError},
        // Wrong format
        {value: '12:30', valid: false, issue: IsTime.timeError},
        {value: '12:30:45:00', valid: false, issue: IsTime.timeError},
        {value: '12.30.45', valid: false, issue: IsTime.timeError},
        {value: '123045', valid: false, issue: IsTime.timeError},
        // Spaces
        {value: '12:30:45 ', valid: false, issue: IsTime.timeError},
        {value: ' 12:30:45', valid: false, issue: IsTime.timeError},
        {value: '12 :30:45', valid: false, issue: IsTime.timeError},
        // Incorrect padding
        {value: '2:30:45', valid: false, issue: IsTime.timeError},
        {value: '12:3:45', valid: false, issue: IsTime.timeError},
        {value: '12:30:5', valid: false, issue: IsTime.timeError},
        // 12-hour format
        {value: '12:30:45 PM', valid: false, issue: IsTime.timeError},
        {value: '12:30:45 AM', valid: false, issue: IsTime.timeError},
        // Empty string
        {value: '', valid: false, issue: IsTime.timeError},
        // Non-string values
        {value: 123045, valid: false, issue: IsStringErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: {}, valid: false, issue: IsStringErrors.typeError},
    ]);

    testValidation('orUndefined', IsTime.orUndefined, [
        {value: undefined, valid: true},
        {value: '14:30:00', valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('orNull', IsTime.orNull, [
        {value: null, valid: true},
        {value: '14:30:00', valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);
});
