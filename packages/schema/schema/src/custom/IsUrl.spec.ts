import {IsUrl} from './IsUrl';
import {GGIssueKey} from "../issue/GGIssueKey";
import {testStringify, testValidation, testUtils} from "../utils/testUtils";
import {IsStringErrors} from "../Errors";


testUtils('IsUrl', () => {

    testStringify('stringify', IsUrl, [
        {value: 'https://example.com', expected: 'https://example.com'},
        {value: 'http://localhost:3000/path?q=1', expected: 'http://localhost:3000/path?q=1'},
    ]);

    testValidation('validation', IsUrl, [
        // Valid HTTP/HTTPS URLs
        {value: 'http://example.com', valid: true},
        {value: 'https://example.com', valid: true},
        {value: 'http://www.example.com', valid: true},
        {value: 'https://sub.domain.example.com', valid: true},
        // URLs with paths
        {value: 'https://example.com/path', valid: true},
        {value: 'https://example.com/path/to/resource', valid: true},
        // URLs with query strings and fragments
        {value: 'https://example.com?query=value', valid: true},
        {value: 'https://example.com/path?a=1&b=2', valid: true},
        {value: 'https://example.com#section', valid: true},
        {value: 'https://example.com?query=value#section', valid: true},
        // URLs with ports
        {value: 'https://example.com:8080', valid: true},
        {value: 'http://localhost:3000', valid: true},
        // URLs with IP addresses
        {value: 'http://192.168.1.1', valid: true},
        {value: 'https://192.168.1.1:8080', valid: true},
        {value: 'http://127.0.0.1', valid: true},
        // IPv6 URLs
        {value: 'http://[::1]', valid: true},
        {value: 'http://[::1]:8080', valid: true},
        {value: 'https://[2001:db8::1]', valid: true},
        {value: 'https://[2001:db8::1]:443/path', valid: true},
        // URLs with authentication (valid but potentially dangerous)
        {value: 'http://user:pass@example.com', valid: true},
        {value: 'https://user@example.com', valid: true},
        // Unicode/IDN domains (punycode)
        {value: 'https://xn--nxasmq5b.com', valid: true},
        // Invalid - no protocol
        {value: 'example.com', valid: false, issue: IsUrl.urlError},
        {value: 'www.example.com', valid: false, issue: IsUrl.urlError},
        // Invalid - non-HTTP protocols
        {value: 'ftp://example.com', valid: false, issue: IsUrl.urlError},
        {value: 'mailto:user@example.com', valid: false, issue: IsUrl.urlError},
        {value: 'file:///path/to/file', valid: false, issue: IsUrl.urlError},
        // Invalid URLs
        {value: 'http://', valid: false, issue: IsUrl.urlError},
        {value: 'https://', valid: false, issue: IsUrl.urlError},
        {value: 'http:// invalid', valid: false, issue: IsUrl.urlError},
        {value: '', valid: false, issue: IsUrl.urlError},
        // Non-string values
        {value: 123, valid: false, issue: IsStringErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: {}, valid: false, issue: IsStringErrors.typeError},
        {value: [], valid: false, issue: IsStringErrors.typeError},
    ]);

    testValidation('orUndefined', IsUrl.orUndefined, [
        {value: undefined, valid: true},
        {value: 'https://example.com', valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('orNull', IsUrl.orNull, [
        {value: null, valid: true},
        {value: 'https://example.com', valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);
});
