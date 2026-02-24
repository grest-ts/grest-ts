import {IsLocale} from './IsLocale';
import {GGIssueKey} from "../issue/GGIssueKey";
import {testStringify, testValidation, testUtils} from "../utils/testUtils";
import {IsStringErrors} from "../Errors";


testUtils('IsLocale', () => {

    testStringify('stringify', IsLocale, [
        {value: 'en', expected: 'en'},
        {value: 'en-US', expected: 'en-US'},
        {value: 'de-DE', expected: 'de-DE'},
        {value: 'et-EE', expected: 'et-EE'},
    ]);

    testValidation('validation', IsLocale, [
        // Valid BCP 47 locale codes - language only
        {value: 'en', valid: true},
        {value: 'de', valid: true},
        {value: 'fr', valid: true},
        {value: 'es', valid: true},
        {value: 'zh', valid: true},
        {value: 'ja', valid: true},
        {value: 'et', valid: true},
        {value: 'ru', valid: true},
        // Valid BCP 47 locale codes - language-region
        {value: 'en-US', valid: true},
        {value: 'en-GB', valid: true},
        {value: 'de-DE', valid: true},
        {value: 'fr-FR', valid: true},
        {value: 'es-ES', valid: true},
        {value: 'zh-CN', valid: true},
        {value: 'zh-TW', valid: true},
        {value: 'ja-JP', valid: true},
        {value: 'ko-KR', valid: true},
        {value: 'pt-BR', valid: true},
        {value: 'pt-PT', valid: true},
        {value: 'et-EE', valid: true},
        {value: 'ru-RU', valid: true},
        // Invalid - region only
        {value: 'US', valid: false, issue: IsLocale.localeError},
        {value: 'DE', valid: false, issue: IsLocale.localeError},
        // Invalid - wrong case (language should be lowercase)
        {value: 'EN', valid: false, issue: IsLocale.localeError},
        {value: 'EN-US', valid: false, issue: IsLocale.localeError},
        {value: 'En-US', valid: false, issue: IsLocale.localeError},
        // Invalid - wrong case (region should be uppercase)
        {value: 'en-us', valid: false, issue: IsLocale.localeError},
        {value: 'en-Us', valid: false, issue: IsLocale.localeError},
        // Invalid - wrong separator
        {value: 'en_US', valid: false, issue: IsLocale.localeError},
        {value: 'en.US', valid: false, issue: IsLocale.localeError},
        {value: 'enUS', valid: false, issue: IsLocale.localeError},
        // Invalid - three-letter language codes
        {value: 'eng-US', valid: false, issue: IsLocale.localeError},
        {value: 'deu-DE', valid: false, issue: IsLocale.localeError},
        // Invalid - three-letter country codes
        {value: 'en-USA', valid: false, issue: IsLocale.localeError},
        {value: 'de-DEU', valid: false, issue: IsLocale.localeError},
        // Invalid - single letter components
        {value: 'e-US', valid: false, issue: IsLocale.localeError},
        {value: 'en-U', valid: false, issue: IsLocale.localeError},
        // Invalid - numbers
        {value: 'e1-US', valid: false, issue: IsLocale.localeError},
        {value: 'en-U1', valid: false, issue: IsLocale.localeError},
        {value: '12-34', valid: false, issue: IsLocale.localeError},
        // Invalid - spaces
        {value: 'en -US', valid: false, issue: IsLocale.localeError},
        {value: 'en- US', valid: false, issue: IsLocale.localeError},
        {value: ' en-US', valid: false, issue: IsLocale.localeError},
        {value: 'en-US ', valid: false, issue: IsLocale.localeError},
        // Empty string
        {value: '', valid: false, issue: IsLocale.localeError},
        // Non-string values
        {value: 123, valid: false, issue: IsStringErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: {}, valid: false, issue: IsStringErrors.typeError},
        {value: [], valid: false, issue: IsStringErrors.typeError},
    ]);

    testValidation('orUndefined', IsLocale.orUndefined, [
        {value: undefined, valid: true},
        {value: 'en-US', valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('orNull', IsLocale.orNull, [
        {value: null, valid: true},
        {value: 'en-US', valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);
});
