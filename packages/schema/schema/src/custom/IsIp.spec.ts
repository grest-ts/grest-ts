import {IsIp} from './IsIp';
import {GGIssueKey} from "../issue/GGIssueKey";
import {testStringify, testValidation, testUtils} from "../utils/testUtils";
import {IsStringErrors} from "../Errors";


testUtils('IsIp', () => {

    testStringify('stringify', IsIp, [
        {value: '192.168.1.1', expected: '192.168.1.1'},
        {value: '::1', expected: '::1'},
    ]);

    testValidation('IPv4', IsIp, [
        // Valid IPv4 addresses
        {value: '192.168.1.1', valid: true},
        {value: '10.0.0.1', valid: true},
        {value: '172.16.0.1', valid: true},
        {value: '8.8.8.8', valid: true},
        // Boundary values
        {value: '0.0.0.0', valid: true},
        {value: '255.255.255.255', valid: true},
        {value: '127.0.0.1', valid: true},
        // Invalid - out of range octets
        {value: '256.0.0.1', valid: false, issue: IsIp.ipError},
        {value: '192.256.1.1', valid: false, issue: IsIp.ipError},
        {value: '192.168.256.1', valid: false, issue: IsIp.ipError},
        {value: '192.168.1.256', valid: false, issue: IsIp.ipError},
        // Invalid - negative numbers
        {value: '-1.0.0.1', valid: false, issue: IsIp.ipError},
        {value: '192.-1.1.1', valid: false, issue: IsIp.ipError},
        // Invalid - missing/extra octets
        {value: '192.168.1', valid: false, issue: IsIp.ipError},
        {value: '192.168', valid: false, issue: IsIp.ipError},
        {value: '192', valid: false, issue: IsIp.ipError},
        {value: '192.168.1.1.1', valid: false, issue: IsIp.ipError},
        // Invalid - non-numeric
        {value: '192.168.a.1', valid: false, issue: IsIp.ipError},
        {value: 'abc.def.ghi.jkl', valid: false, issue: IsIp.ipError},
        // Invalid - spaces
        {value: '192.168. 1.1', valid: false, issue: IsIp.ipError},
        {value: ' 192.168.1.1', valid: false, issue: IsIp.ipError},
        {value: '192.168.1.1 ', valid: false, issue: IsIp.ipError},
    ]);

    testValidation('IPv6', IsIp, [
        // Standard IPv6
        {value: '2001:0db8:85a3:0000:0000:8a2e:0370:7334', valid: true},
        {value: '2001:db8:85a3:0:0:8a2e:370:7334', valid: true},
        {value: 'fe80:0:0:0:0:0:0:1', valid: true},
        // Compressed IPv6
        {value: '::1', valid: true},
        {value: '::', valid: true},
        {value: '2001:db8::1', valid: true},
        {value: '::ffff:192.168.1.1', valid: true},
        // Full notation
        {value: '0000:0000:0000:0000:0000:0000:0000:0001', valid: true},
        {value: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', valid: true},
    ]);

    testValidation('invalid values', IsIp, [
        {value: 'not an ip', valid: false, issue: IsIp.ipError},
        {value: 'hello.world.foo.bar', valid: false, issue: IsIp.ipError},
        {value: '', valid: false, issue: IsIp.ipError},
        // Non-string values
        {value: 192168001001, valid: false, issue: IsStringErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: {}, valid: false, issue: IsStringErrors.typeError},
        {value: [], valid: false, issue: IsStringErrors.typeError},
    ]);

    testValidation('orUndefined', IsIp.orUndefined, [
        {value: undefined, valid: true},
        {value: '192.168.1.1', valid: true},
        {value: '::1', valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('orNull', IsIp.orNull, [
        {value: null, valid: true},
        {value: '192.168.1.1', valid: true},
        {value: '::1', valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);
});
