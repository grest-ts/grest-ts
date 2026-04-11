import {IsUnion} from './IsUnion';
import {IsString} from './IsString';
import {IsNumber} from './IsNumber';
import {IsBoolean} from './IsBoolean';
import {IsLiteral} from './IsLiteral';
import {GGIssueKey} from "../issue/GGIssueKey";
import {GGIssuesList} from "../issue/GGIssuesList";
import {testObjectValidation, testStringify, testUtils} from "../utils/testUtils";
import {IsUnionErrors} from "../Errors";

testUtils('IsUnion', () => {

    describe('factory function', () => {
        it('should throw if less than two variants provided', () => {
            expect(() => IsUnion(IsString)).toThrow('IsUnion requires at least two variants');
        });
    });

    const StringOrNumber = IsUnion(IsString, IsNumber);

    testObjectValidation('validation string|number', StringOrNumber, [
        {value: 'hello', valid: true},
        {value: '', valid: true},
        {value: 42, valid: true},
        {value: 0, valid: true},
        {value: -3.14, valid: true},
        {value: true, valid: false, issue: IsUnionErrors.unionError},
        {value: false, valid: false, issue: IsUnionErrors.unionError},
        {value: {}, valid: false, issue: IsUnionErrors.unionError},
        {value: [], valid: false, issue: IsUnionErrors.unionError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);

    testObjectValidation('orUndefined', StringOrNumber.orUndefined, [
        {value: undefined, valid: true},
        {value: 'hello', valid: true},
        {value: 42, valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: true, valid: false, issue: IsUnionErrors.unionError},
    ]);

    testObjectValidation('orNull', StringOrNumber.orNull, [
        {value: null, valid: true},
        {value: 'hello', valid: true},
        {value: 42, valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: false, valid: false, issue: IsUnionErrors.unionError},
    ]);

    describe('three variants', () => {
        const StringOrNumberOrBoolean = IsUnion(IsString, IsNumber, IsBoolean);

        testObjectValidation('validation', StringOrNumberOrBoolean, [
            {value: 'hello', valid: true},
            {value: 42, valid: true},
            {value: true, valid: true},
            {value: false, valid: true},
            {value: null, valid: false, issue: GGIssueKey.required},
            {value: {}, valid: false, issue: IsUnionErrors.unionError},
        ]);
    });

    describe('literal union', () => {
        const StatusUnion = IsUnion(
            IsLiteral('pending'),
            IsLiteral('active'),
            IsLiteral('completed')
        );

        testObjectValidation('validation', StatusUnion, [
            {value: 'pending', valid: true},
            {value: 'active', valid: true},
            {value: 'completed', valid: true},
            {value: 'cancelled', valid: false, issue: IsUnionErrors.unionError},
            {value: '', valid: false, issue: IsUnionErrors.unionError},
            {value: 42, valid: false, issue: IsUnionErrors.unionError},
        ]);
    });

    describe('coercion', () => {
        it('should try coercion on variants', () => {
            const issues = new GGIssuesList();
            // Boolean coerces to string 'true' via first matching variant
            const result = StringOrNumber._parse(true, issues, 'test', true);
            expect(result).toBe('true');
            expect(issues.length).toBe(0);
        });
    });

    describe('first matching variant wins', () => {
        const NumberFirst = IsUnion(IsNumber.min(0), IsString);

        it('should use first matching variant for parse', () => {
            const issues = new GGIssuesList();
            expect(NumberFirst._parse(42, issues, 'test')).toBe(42);
            expect(issues.length).toBe(0);
        });

        it('should fall through to next variant if first fails', () => {
            const issues = new GGIssuesList();
            // 'hello' fails IsNumber.min(0), but matches IsString
            expect(NumberFirst._parse('hello', issues, 'test')).toBe('hello');
            expect(issues.length).toBe(0);
        });
    });

    describe('union with constraints', () => {
        const PositiveOrString = IsUnion(IsNumber.min(0), IsString);

        testObjectValidation('validation', PositiveOrString, [
            {value: 0, valid: true},
            {value: 42, valid: true},
            {value: 'hello', valid: true},
            {value: -1, valid: false, issue: IsUnionErrors.unionError},
        ]);
    });

    describe('docs()', () => {
        it('should add documentation', () => {
            const schema = StringOrNumber.docs({
                title: 'StringOrNumber',
                description: 'Either a string or a number'
            });
            expect(schema.def.docs?.title).toBe('StringOrNumber');
            expect(schema.def.docs?.description).toBe('Either a string or a number');
        });
    });

    // ==================== Stringify ====================

    testStringify('stringify string|number', StringOrNumber, [
        {value: 'hello', expected: 'hello'},
        {value: '', expected: ''},
        {value: 42, expected: 42},
        {value: 0, expected: 0},
    ]);

    testStringify('stringify three variants', IsUnion(IsString, IsNumber, IsBoolean), [
        {value: 'hello', expected: 'hello'},
        {value: 42, expected: 42},
        {value: true, expected: true},
        {value: false, expected: false},
    ]);

    testStringify('stringify orNull', StringOrNumber.orNull, [
        {value: 'hello', expected: 'hello'},
        {value: 42, expected: 42},
        {value: null, expected: null},
    ]);

    // ==================== toJSONSchema ====================

    describe('toJSONSchema()', () => {
        it('two variants', () => {
            expect(IsUnion(IsString, IsNumber).toJSONSchema())
                .toEqual({oneOf: [{type: 'string'}, {type: 'number'}]});
        });
        it('three variants', () => {
            expect(IsUnion(IsString, IsNumber, IsBoolean).toJSONSchema())
                .toEqual({oneOf: [{type: 'string'}, {type: 'number'}, {type: 'boolean'}]});
        });
        it('nullable adds null to oneOf wrapper', () => {
            const s = IsUnion(IsString, IsNumber).orNull.toJSONSchema() as any;
            expect(s.oneOf).toHaveLength(2);
            expect(s.oneOf[1]).toEqual({type: 'null'});
        });
    });
});
