import {IsInt, IsInt16, IsInt32, IsInt8, IsPosInt, IsUint, IsUint16, IsUint32, IsUint8} from './IsInt';
import {GGIssueKey} from "../issue/GGIssueKey";
import {testCoercion, testValidation, testUtils} from "../utils/testUtils";
import {IsNumberErrors} from "../Errors";


testUtils('IsInt', () => {

    testValidation('validation', IsInt, [
        {value: 0, valid: true},
        {value: 1, valid: true},
        {value: -1, valid: true},
        {value: 1000000, valid: true},
        {value: -1000000, valid: true},
        // Floats rejected
        {value: 1.5, valid: false, issue: IsNumberErrors.integerError},
        {value: -1.5, valid: false, issue: IsNumberErrors.integerError},
        {value: 0.1, valid: false, issue: IsNumberErrors.integerError},
        // Special values (NaN and Infinity fail type check)
        {value: NaN, valid: false, issue: IsNumberErrors.typeError},
        {value: Infinity, valid: false, issue: IsNumberErrors.typeError},
        {value: -Infinity, valid: false, issue: IsNumberErrors.typeError},
        // Non-numbers
        {value: '123', valid: false, issue: IsNumberErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);

    testCoercion('coercion', IsInt, [
        {value: '42', result: 42},
        {value: '-10', result: -10},
        {value: '1.5', result: undefined, issue: IsNumberErrors.integerError},
    ]);
});

testUtils('IsPosInt', () => {

    testValidation('validation', IsPosInt, [
        {value: 1, valid: true},
        {value: 2, valid: true},
        {value: 1000000, valid: true},
        // Zero rejected (must be > 0)
        {value: 0, valid: false, issue: IsNumberErrors.minError},
        // Negative rejected
        {value: -1, valid: false, issue: IsNumberErrors.minError},
        // Floats rejected
        {value: 1.5, valid: false, issue: IsNumberErrors.integerError},
        // Non-numbers
        {value: '1', valid: false, issue: IsNumberErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);

    testCoercion('coercion', IsPosInt, [
        {value: '42', result: 42},
        {value: '1', result: 1},
        {value: '0', result: undefined, issue: IsNumberErrors.minError},
        {value: '-1', result: undefined, issue: IsNumberErrors.minError},
    ]);
});

testUtils('IsUint', () => {

    testValidation('validation', IsUint, [
        {value: 0, valid: true},
        {value: 1, valid: true},
        {value: 1000000, valid: true},
        // Negative rejected
        {value: -1, valid: false, issue: IsNumberErrors.minError},
        {value: -1000000, valid: false, issue: IsNumberErrors.minError},
        // Floats rejected
        {value: 1.5, valid: false, issue: IsNumberErrors.integerError},
    ]);
});

testUtils('IsUint8', () => {

    testValidation('validation', IsUint8, [
        {value: 0, valid: true},
        {value: 128, valid: true},
        {value: 255, valid: true},
        // Out of range
        {value: -1, valid: false, issue: IsNumberErrors.rangeError},
        {value: 256, valid: false, issue: IsNumberErrors.rangeError},
        {value: 1000, valid: false, issue: IsNumberErrors.rangeError},
        // Floats rejected
        {value: 1.5, valid: false, issue: IsNumberErrors.integerError},
        {value: 127.5, valid: false, issue: IsNumberErrors.integerError},
    ]);
});

testUtils('IsUint16', () => {

    testValidation('validation', IsUint16, [
        {value: 0, valid: true},
        {value: 32768, valid: true},
        {value: 65535, valid: true},
        // Out of range
        {value: -1, valid: false, issue: IsNumberErrors.rangeError},
        {value: 65536, valid: false, issue: IsNumberErrors.rangeError},
    ]);
});

testUtils('IsUint32', () => {

    testValidation('validation', IsUint32, [
        {value: 0, valid: true},
        {value: 2147483648, valid: true},
        {value: 4294967295, valid: true},
        // Out of range
        {value: -1, valid: false, issue: IsNumberErrors.rangeError},
        {value: 4294967296, valid: false, issue: IsNumberErrors.rangeError},
    ]);
});

testUtils('IsInt8', () => {

    testValidation('validation', IsInt8, [
        {value: -128, valid: true},
        {value: 0, valid: true},
        {value: 127, valid: true},
        // Out of range
        {value: -129, valid: false, issue: IsNumberErrors.rangeError},
        {value: 128, valid: false, issue: IsNumberErrors.rangeError},
        // Floats rejected
        {value: 1.5, valid: false, issue: IsNumberErrors.integerError},
        {value: -1.5, valid: false, issue: IsNumberErrors.integerError},
    ]);
});

testUtils('IsInt16', () => {

    testValidation('validation', IsInt16, [
        {value: -32768, valid: true},
        {value: 0, valid: true},
        {value: 32767, valid: true},
        // Out of range
        {value: -32769, valid: false, issue: IsNumberErrors.rangeError},
        {value: 32768, valid: false, issue: IsNumberErrors.rangeError},
    ]);
});

testUtils('IsInt32', () => {

    testValidation('validation', IsInt32, [
        {value: -2147483648, valid: true},
        {value: 0, valid: true},
        {value: 2147483647, valid: true},
        // Out of range
        {value: -2147483649, valid: false, issue: IsNumberErrors.rangeError},
        {value: 2147483648, valid: false, issue: IsNumberErrors.rangeError},
    ]);
});

testUtils('Integer validators - optional', () => {

    testValidation('IsInt.orUndefined', IsInt.orUndefined, [
        {value: undefined, valid: true},
        {value: 42, valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('IsInt.orNull', IsInt.orNull, [
        {value: null, valid: true},
        {value: 42, valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('IsUint.orUndefined', IsUint.orUndefined, [
        {value: undefined, valid: true},
        {value: 42, valid: true},
    ]);

    testValidation('IsUint.orNull', IsUint.orNull, [
        {value: null, valid: true},
        {value: 42, valid: true},
    ]);
});
