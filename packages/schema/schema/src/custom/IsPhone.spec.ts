import {IsPhone} from './IsPhone';
import {GGIssueKey} from "../issue/GGIssueKey";
import {testStringify, testValidation, testUtils} from "../utils/testUtils";
import {IsStringErrors} from "../Errors";


testUtils('IsPhone', () => {

    testStringify('stringify', IsPhone, [
        {value: '+12025551234', expected: '+12025551234'},
        {value: '+442071234567', expected: '+442071234567'},
    ]);

    testValidation('validation', IsPhone, [
        // Valid international phone numbers
        {value: '+12025551234', valid: true},
        {value: '+442071234567', valid: true},
        {value: '+491234567890', valid: true},
        {value: '+37212345678', valid: true},
        // Minimum length (8 chars including +)
        {value: '+1234567', valid: true},
        // Maximum length (15 chars including +)
        {value: '+12345678901234', valid: true},
        // Invalid - too short
        {value: '+123456', valid: false, issue: IsPhone.lengthError},
        // Invalid - too long
        {value: '+123456789012345', valid: false, issue: IsPhone.lengthError},
        // Invalid - no + prefix
        {value: '12025551234', valid: false, issue: IsPhone.countryCodeError},
        {value: '2025551234', valid: false, issue: IsPhone.countryCodeError},
        // Invalid - formatting characters
        {value: '+1-202-555-1234', valid: false, issue: IsPhone.formatError},
        {value: '+1 202 555 1234', valid: false, issue: IsPhone.formatError},
        {value: '+1(202)5551234', valid: false, issue: IsPhone.formatError},
        {value: '+1.202.555.1234', valid: false, issue: IsPhone.formatError},
        // Invalid - letters
        {value: '+1202555CALL', valid: false, issue: IsPhone.formatError},
        {value: '+1abc2345678', valid: false, issue: IsPhone.formatError},
        // Invalid - empty or just +
        {value: '', valid: false, issue: IsPhone.countryCodeError},
        {value: '+', valid: false, issue: IsPhone.lengthError},
        // Non-string values
        {value: 12025551234, valid: false, issue: IsStringErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: {}, valid: false, issue: IsStringErrors.typeError},
        {value: [], valid: false, issue: IsStringErrors.typeError},
    ]);

    testValidation('orUndefined', IsPhone.orUndefined, [
        {value: undefined, valid: true},
        {value: '+12025551234', valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('orNull', IsPhone.orNull, [
        {value: null, valid: true},
        {value: '+12025551234', valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);
});
