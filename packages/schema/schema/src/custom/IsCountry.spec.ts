import {IsCountry} from './IsCountry';
import {GGIssueKey} from "../issue/GGIssueKey";
import {testStringify, testValidation, testUtils} from "../utils/testUtils";
import {IsStringErrors} from "../Errors";


testUtils('IsCountry', () => {

    testStringify('stringify', IsCountry, [
        {value: 'US', expected: 'US'},
        {value: 'EE', expected: 'EE'},
    ]);

    testValidation('validation', IsCountry, [
        // Valid ISO 3166-1 alpha-2 codes
        {value: 'US', valid: true},
        {value: 'GB', valid: true},
        {value: 'DE', valid: true},
        {value: 'FR', valid: true},
        {value: 'JP', valid: true},
        {value: 'CN', valid: true},
        {value: 'AU', valid: true},
        {value: 'EE', valid: true},
        // Invalid - lowercase
        {value: 'us', valid: false, issue: IsCountry.countryError},
        {value: 'gb', valid: false, issue: IsCountry.countryError},
        // Invalid - mixed case
        {value: 'Us', valid: false, issue: IsCountry.countryError},
        {value: 'uS', valid: false, issue: IsCountry.countryError},
        // Invalid - three-letter codes
        {value: 'USA', valid: false, issue: IsCountry.countryError},
        {value: 'GBR', valid: false, issue: IsCountry.countryError},
        // Invalid - single letter
        {value: 'U', valid: false, issue: IsCountry.countryError},
        // Invalid - numbers/special chars
        {value: 'U1', valid: false, issue: IsCountry.countryError},
        {value: '12', valid: false, issue: IsCountry.countryError},
        {value: 'U!', valid: false, issue: IsCountry.countryError},
        // Invalid - spaces
        {value: 'U S', valid: false, issue: IsCountry.countryError},
        {value: ' US', valid: false, issue: IsCountry.countryError},
        {value: 'US ', valid: false, issue: IsCountry.countryError},
        // Empty string
        {value: '', valid: false, issue: IsCountry.countryError},
        // Non-string values
        {value: 123, valid: false, issue: IsStringErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: {}, valid: false, issue: IsStringErrors.typeError},
        {value: [], valid: false, issue: IsStringErrors.typeError},
    ]);

    testValidation('orUndefined', IsCountry.orUndefined, [
        {value: undefined, valid: true},
        {value: 'US', valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('orNull', IsCountry.orNull, [
        {value: null, valid: true},
        {value: 'US', valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);
});
