import {IsLanguage} from './IsLanguage';
import {GGIssueKey} from "../issue/GGIssueKey";
import {testCoercion, testStringify, testValidation, testUtils} from "../utils/testUtils";
import {IsStringErrors} from "../Errors";


testUtils('IsLanguage', () => {

    testStringify('stringify', IsLanguage, [
        {value: 'en', expected: 'en'},
        {value: 'et', expected: 'et'},
    ]);

    testValidation('validation', IsLanguage, [
        // Valid ISO 639-1 codes
        {value: 'en', valid: true},
        {value: 'de', valid: true},
        {value: 'fr', valid: true},
        {value: 'es', valid: true},
        {value: 'zh', valid: true},
        {value: 'ja', valid: true},
        {value: 'et', valid: true},
        {value: 'ru', valid: true},
        // Invalid - uppercase
        {value: 'EN', valid: false, issue: IsLanguage.languageError},
        {value: 'DE', valid: false, issue: IsLanguage.languageError},
        // Invalid - mixed case
        {value: 'En', valid: false, issue: IsLanguage.languageError},
        {value: 'eN', valid: false, issue: IsLanguage.languageError},
        // Invalid - three-letter codes (ISO 639-2)
        {value: 'eng', valid: false, issue: IsLanguage.languageError},
        {value: 'deu', valid: false, issue: IsLanguage.languageError},
        // Invalid - single letter
        {value: 'e', valid: false, issue: IsLanguage.languageError},
        // Invalid - numbers/special chars
        {value: 'e1', valid: false, issue: IsLanguage.languageError},
        {value: '12', valid: false, issue: IsLanguage.languageError},
        {value: 'e-', valid: false, issue: IsLanguage.languageError},
        // Invalid - spaces
        {value: 'e n', valid: false, issue: IsLanguage.languageError},
        {value: ' en', valid: false, issue: IsLanguage.languageError},
        {value: 'en ', valid: false, issue: IsLanguage.languageError},
        // Empty string
        {value: '', valid: false, issue: IsLanguage.languageError},
        // Non-string values
        {value: 123, valid: false, issue: IsStringErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: {}, valid: false, issue: IsStringErrors.typeError},
        {value: [], valid: false, issue: IsStringErrors.typeError},
    ]);

    testValidation('orUndefined', IsLanguage.orUndefined, [
        {value: undefined, valid: true},
        {value: 'en', valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('orNull', IsLanguage.orNull, [
        {value: null, valid: true},
        {value: 'en', valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);

    testCoercion('coercion', IsLanguage, [
        // Already valid - pass through
        {value: 'en', result: 'en'},
        {value: 'de', result: 'de'},
        // Locale format - extract language
        {value: 'en-US', result: 'en'},
        {value: 'de-DE', result: 'de'},
        {value: 'zh-CN', result: 'zh'},
        {value: 'pt-BR', result: 'pt'},
        // Accept-Language header format - take first
        {value: 'en,de', result: 'en'},
        {value: 'en,de,fr', result: 'en'},
        {value: 'en-US,de-DE', result: 'en'},
        // Uppercase - lowercase
        {value: 'EN', result: 'en'},
        {value: 'EN-US', result: 'en'},
        // Mixed case
        {value: 'En', result: 'en'},
        {value: 'eN-uS', result: 'en'},
        // Invalid values - coercion runs but validation fails
        {value: '*', result: undefined, issue: IsLanguage.languageError},
        {value: '', result: undefined, issue: IsLanguage.languageError},
        {value: 'eng', result: undefined, issue: IsLanguage.languageError},  // 3 chars after coercion
    ]);
});
