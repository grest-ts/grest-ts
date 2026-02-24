import {IsCurrency} from './IsCurrency';
import {GGIssueKey} from "../issue/GGIssueKey";
import {testStringify, testValidation, testUtils} from "../utils/testUtils";
import {IsStringErrors} from "../Errors";


testUtils('IsCurrency', () => {

    testStringify('stringify', IsCurrency, [
        {value: 'USD', expected: 'USD'},
        {value: 'EUR', expected: 'EUR'},
    ]);

    testValidation('validation', IsCurrency, [
        // Valid ISO 4217 codes
        {value: 'USD', valid: true},
        {value: 'EUR', valid: true},
        {value: 'GBP', valid: true},
        {value: 'JPY', valid: true},
        {value: 'CNY', valid: true},
        {value: 'CHF', valid: true},
        {value: 'AUD', valid: true},
        {value: 'CAD', valid: true},
        // Invalid - lowercase
        {value: 'usd', valid: false, issue: IsCurrency.currencyError},
        {value: 'eur', valid: false, issue: IsCurrency.currencyError},
        // Invalid - mixed case
        {value: 'Usd', valid: false, issue: IsCurrency.currencyError},
        {value: 'uSd', valid: false, issue: IsCurrency.currencyError},
        // Invalid - two/four letters
        {value: 'US', valid: false, issue: IsCurrency.currencyError},
        {value: 'USDD', valid: false, issue: IsCurrency.currencyError},
        // Invalid - numbers/special chars
        {value: 'US1', valid: false, issue: IsCurrency.currencyError},
        {value: '123', valid: false, issue: IsCurrency.currencyError},
        {value: 'US$', valid: false, issue: IsCurrency.currencyError},
        // Invalid - spaces
        {value: 'U SD', valid: false, issue: IsCurrency.currencyError},
        {value: ' USD', valid: false, issue: IsCurrency.currencyError},
        {value: 'USD ', valid: false, issue: IsCurrency.currencyError},
        // Empty string
        {value: '', valid: false, issue: IsCurrency.currencyError},
        // Non-string values
        {value: 123, valid: false, issue: IsStringErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: {}, valid: false, issue: IsStringErrors.typeError},
        {value: [], valid: false, issue: IsStringErrors.typeError},
    ]);

    testValidation('orUndefined', IsCurrency.orUndefined, [
        {value: undefined, valid: true},
        {value: 'USD', valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('orNull', IsCurrency.orNull, [
        {value: null, valid: true},
        {value: 'USD', valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);
});
