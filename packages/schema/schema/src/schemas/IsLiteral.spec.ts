import {IsLiteral} from './IsLiteral';
import {GGIssuesList} from "../issue/GGIssuesList";
import {testStringify, testUtils} from "../utils/testUtils";

testUtils('IsLiteral', () => {
    describe('factory function', () => {
        it('should throw if no values provided', () => {
            expect(() => IsLiteral()).toThrow('LiteralSchema requires at least one value');
        });
    });

    describe('is() method - single value', () => {
        const IsHello = IsLiteral('hello');

        it('should validate the exact literal value', () => {
            expect(IsHello.is('hello')).toBe(true);
        });

        it('should reject any other value', () => {
            expect(IsHello.is('Hello')).toBe(false);
            expect(IsHello.is('HELLO')).toBe(false);
            expect(IsHello.is('hello ')).toBe(false);
            expect(IsHello.is('world')).toBe(false);
            expect(IsHello.is(123)).toBe(false);
            expect(IsHello.is(null)).toBe(false);
            expect(IsHello.is(undefined)).toBe(false);
        });
    });

    describe('is() method - multiple values', () => {
        const StatusLiteral = IsLiteral('pending', 'active', 'completed');

        it('should validate any of the literal values', () => {
            expect(StatusLiteral.is('pending')).toBe(true);
            expect(StatusLiteral.is('active')).toBe(true);
            expect(StatusLiteral.is('completed')).toBe(true);
        });

        it('should reject values not in the set', () => {
            expect(StatusLiteral.is('cancelled')).toBe(false);
            expect(StatusLiteral.is('PENDING')).toBe(false);
            expect(StatusLiteral.is('')).toBe(false);
        });
    });

    describe('is() method - number literals', () => {
        const NumberLiteral = IsLiteral(1, 2, 3);

        it('should validate number literals', () => {
            expect(NumberLiteral.is(1)).toBe(true);
            expect(NumberLiteral.is(2)).toBe(true);
            expect(NumberLiteral.is(3)).toBe(true);
        });

        it('should reject other numbers', () => {
            expect(NumberLiteral.is(0)).toBe(false);
            expect(NumberLiteral.is(4)).toBe(false);
            expect(NumberLiteral.is('1')).toBe(false);
        });
    });

    describe('is() method - boolean literals', () => {
        const TrueLiteral = IsLiteral(true);
        const FalseLiteral = IsLiteral(false);

        it('should validate boolean literals', () => {
            expect(TrueLiteral.is(true)).toBe(true);
            expect(TrueLiteral.is(false)).toBe(false);

            expect(FalseLiteral.is(false)).toBe(true);
            expect(FalseLiteral.is(true)).toBe(false);
        });
    });

    describe('is() method - mixed type literals', () => {
        const MixedLiteral = IsLiteral('auto', 0, false);

        it('should validate any of the mixed type literals', () => {
            expect(MixedLiteral.is('auto')).toBe(true);
            expect(MixedLiteral.is(0)).toBe(true);
            expect(MixedLiteral.is(false)).toBe(true);
        });

        it('should reject similar but not identical values', () => {
            expect(MixedLiteral.is('0')).toBe(false);
            expect(MixedLiteral.is(1)).toBe(false);
            expect(MixedLiteral.is(true)).toBe(false);
        });
    });

    describe('parse() method', () => {
        const StatusLiteral = IsLiteral('pending', 'active', 'completed');

        it('should return value for valid literals', () => {
            const issues = new GGIssuesList();
            expect(StatusLiteral._parse('pending', issues, 'test')).toBe('pending');
            expect(issues.length).toBe(0);
        });

        it('should return undefined and add issues for invalid values', () => {
            let issues = new GGIssuesList();
            expect(StatusLiteral._parse('cancelled', issues, 'test')).toBeUndefined();
            expect(issues.getIssue(0)?.code).toBe('invalid.literal.invalid');

            issues = new GGIssuesList();
            expect(StatusLiteral._parse(null, issues, 'test')).toBeUndefined();
            expect(issues.getIssue(0)?.code).toBe('required');
        });

        it('should include expected values in error params', () => {
            const issues = new GGIssuesList();
            StatusLiteral._parse('invalid', issues, 'test');
            const params = issues.getParams(0) as { expected: string };
            expect(params.expected).toBe('pending, active, completed');
        });
    });

    describe('assert() method', () => {
        const StatusLiteral = IsLiteral('pending', 'active', 'completed');

        it('should not throw for valid literals', () => {
            expect(() => StatusLiteral.assert('pending')).not.toThrow();
            expect(() => StatusLiteral.assert('active')).not.toThrow();
        });

        it('should throw for invalid values', () => {
            expect(() => StatusLiteral.assert('cancelled')).toThrow();
            expect(() => StatusLiteral.assert(null)).toThrow();
        });
    });

    describe('orUndefined', () => {
        const StatusLiteral = IsLiteral('pending', 'active');

        it('should accept undefined', () => {
            expect(StatusLiteral.orUndefined.is(undefined)).toBe(true);
            expect(StatusLiteral.orUndefined.is('pending')).toBe(true);
        });

        it('should parse undefined without issues', () => {
            const issues = new GGIssuesList();
            expect(StatusLiteral.orUndefined._parse(undefined, issues, 'test')).toBeUndefined();
            expect(issues.length).toBe(0);
        });
    });

    describe('orNull', () => {
        const StatusLiteral = IsLiteral('pending', 'active');

        it('should accept null', () => {
            expect(StatusLiteral.orNull.is(null)).toBe(true);
            expect(StatusLiteral.orNull.is('pending')).toBe(true);
        });

        it('should parse null without issues', () => {
            const issues = new GGIssuesList();
            expect(StatusLiteral.orNull._parse(null, issues, 'test')).toBe(null);
            expect(issues.length).toBe(0);
        });
    });

    describe('edge cases', () => {
        it('should handle empty string as literal', () => {
            const EmptyString = IsLiteral('');
            expect(EmptyString.is('')).toBe(true);
            expect(EmptyString.is(' ')).toBe(false);
            expect(EmptyString.is('a')).toBe(false);
        });

        it('should handle negative numbers', () => {
            const NegativeNum = IsLiteral(-1, -2, -3);
            expect(NegativeNum.is(-1)).toBe(true);
            expect(NegativeNum.is(-2)).toBe(true);
            expect(NegativeNum.is(1)).toBe(false);
            expect(NegativeNum.is(0)).toBe(false);
        });

        it('should handle zero', () => {
            const ZeroLiteral = IsLiteral(0);
            expect(ZeroLiteral.is(0)).toBe(true);
            expect(ZeroLiteral.is(-0)).toBe(true); // -0 === 0 in JS
            expect(ZeroLiteral.is('0')).toBe(false);
            expect(ZeroLiteral.is(false)).toBe(false);
        });

        it('should deduplicate values', () => {
            const Duplicated = IsLiteral('a', 'a', 'b', 'b', 'b');
            expect(Duplicated.is('a')).toBe(true);
            expect(Duplicated.is('b')).toBe(true);
            expect(Duplicated.is('c')).toBe(false);
        });

        it('should throw for Infinity', () => {
            expect(() => IsLiteral(Infinity)).toThrow('LiteralSchema does not accept Infinity - only finite numbers are allowed');
        });

        it('should throw for -Infinity', () => {
            expect(() => IsLiteral(-Infinity)).toThrow('LiteralSchema does not accept -Infinity - only finite numbers are allowed');
        });

        it('should throw for NaN', () => {
            expect(() => IsLiteral(NaN)).toThrow('LiteralSchema does not accept NaN - only finite numbers are allowed');
        });

        it('should throw if any value is non-finite', () => {
            expect(() => IsLiteral(1, 2, Infinity)).toThrow('LiteralSchema does not accept Infinity - only finite numbers are allowed');
            expect(() => IsLiteral('a', NaN, 'b')).toThrow('LiteralSchema does not accept NaN - only finite numbers are allowed');
        });
    });

    // ==================== Stringify ====================

    testStringify('stringify string literals', IsLiteral('pending', 'active'), [
        {value: 'pending', expected: 'pending'},
        {value: 'active', expected: 'active'},
    ]);

    testStringify('stringify number literals', IsLiteral(1, 2, 3), [
        {value: 1, expected: 1},
        {value: 2, expected: 2},
        {value: 3, expected: 3},
    ]);

    testStringify('stringify boolean literals', IsLiteral(true), [
        {value: true, expected: true},
    ]);

    testStringify('stringify mixed literals', IsLiteral('auto', 0, false), [
        {value: 'auto', expected: 'auto'},
        {value: 0, expected: 0},
        {value: false, expected: false},
    ]);

    testStringify('stringify orNull', IsLiteral('a', 'b').orNull, [
        {value: 'a', expected: 'a'},
        {value: null, expected: null},
    ]);

    // ==================== toJSONSchema ====================

    describe('toJSONSchema()', () => {
        it('single string value', () => {
            expect(IsLiteral('admin').toJSONSchema()).toEqual({enum: ['admin']});
        });
        it('multiple string values', () => {
            expect(IsLiteral('a', 'b', 'c').toJSONSchema()).toEqual({enum: ['a', 'b', 'c']});
        });
        it('mixed string and number', () => {
            expect(IsLiteral(1, 2, 'three').toJSONSchema()).toEqual({enum: [1, 2, 'three']});
        });
        it('nullable', () => {
            expect(IsLiteral('x').orNull.toJSONSchema())
                .toEqual({oneOf: [{enum: ['x']}, {type: 'null'}]});
        });
    });
});
