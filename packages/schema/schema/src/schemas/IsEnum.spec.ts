import {IsEnum} from './IsEnum';
import {GGIssueKey} from "../issue/GGIssueKey";
import {GGIssuesList} from "../issue/GGIssuesList";
import {testStringify, testValidation, testUtils} from "../utils/testUtils";
import {IsLiteralErrors} from "../Errors";

// Define test issues outside utilsSpec to avoid double registration
const mustBeActiveError = new GGIssueKey('enum_must_be_active', 'Status must be active');

testUtils('IsEnum', () => {

    // ==================== Factory Validation ====================

    describe('factory function', () => {
        it('should throw for null', () => {
            expect(() => IsEnum(null as any)).toThrow('IsEnum requires an enum object');
        });

        it('should throw for undefined', () => {
            expect(() => IsEnum(undefined as any)).toThrow('IsEnum requires an enum object');
        });

        it('should throw for non-object', () => {
            expect(() => IsEnum('string' as any)).toThrow('IsEnum requires an enum object');
            expect(() => IsEnum(123 as any)).toThrow('IsEnum requires an enum object');
        });

        it('should throw for empty object', () => {
            expect(() => IsEnum({} as any)).toThrow('IsEnum requires an enum with at least one value');
        });
    });

    // ==================== String Enum ====================

    describe('string enum', () => {
        enum Status {
            Pending = 'pending',
            Active = 'active',
            Completed = 'completed'
        }

        const StatusSchema = IsEnum(Status);

        testValidation('validates enum values', StatusSchema, [
            {value: 'pending', valid: true},
            {value: 'active', valid: true},
            {value: 'completed', valid: true},
            {value: Status.Pending, valid: true},
            {value: Status.Active, valid: true},
        ]);

        testValidation('rejects non-enum values', StatusSchema, [
            {value: 'cancelled', valid: false, issue: IsLiteralErrors.invalidError},
            {value: 'Pending', valid: false, issue: IsLiteralErrors.invalidError},
            {value: '', valid: false, issue: IsLiteralErrors.invalidError},
            {value: null, valid: false, issue: GGIssueKey.required},
            {value: undefined, valid: false, issue: GGIssueKey.required},
        ]);
    });

    // ==================== Numeric Enum ====================

    describe('numeric enum', () => {
        enum Priority {
            Low = 0,
            Medium = 1,
            High = 2
        }

        const PrioritySchema = IsEnum(Priority);

        testValidation('validates numeric enum values', PrioritySchema, [
            {value: 0, valid: true},
            {value: 1, valid: true},
            {value: 2, valid: true},
            {value: Priority.Low, valid: true},
            {value: Priority.High, valid: true},
        ]);

        testValidation('rejects non-enum values', PrioritySchema, [
            {value: 3, valid: false, issue: IsLiteralErrors.invalidError},
            {value: -1, valid: false, issue: IsLiteralErrors.invalidError},
            {value: 'Low', valid: false, issue: IsLiteralErrors.invalidError},
            {value: '0', valid: false, issue: IsLiteralErrors.invalidError},
        ]);

        it('should not validate reverse mapping keys', () => {
            // Numeric enums have reverse mappings (e.g., Priority[0] = 'Low')
            // These should not be valid enum values
            expect(PrioritySchema.is('Low')).toBe(false);
            expect(PrioritySchema.is('Medium')).toBe(false);
        });
    });

    // ==================== Const Object (enum alternative) ====================

    describe('const object (enum alternative)', () => {
        const Direction = {
            Up: 'up',
            Down: 'down',
            Left: 'left',
            Right: 'right'
        } as const;

        type Direction = typeof Direction[keyof typeof Direction];

        const DirectionSchema = IsEnum(Direction);

        testValidation('validates const object values', DirectionSchema, [
            {value: 'up', valid: true},
            {value: 'down', valid: true},
            {value: 'left', valid: true},
            {value: 'right', valid: true},
        ]);

        testValidation('rejects non-enum values', DirectionSchema, [
            {value: 'forward', valid: false, issue: IsLiteralErrors.invalidError},
            {value: 'Up', valid: false, issue: IsLiteralErrors.invalidError},
        ]);
    });

    // ==================== Heterogeneous Enum ====================

    describe('heterogeneous enum', () => {
        enum Mixed {
            Text = 'text',
            Number = 42
        }

        const MixedSchema = IsEnum(Mixed);

        testValidation('validates both string and number values', MixedSchema, [
            {value: 'text', valid: true},
            {value: 42, valid: true},
        ]);

        testValidation('rejects non-enum values', MixedSchema, [
            {value: 'number', valid: false, issue: IsLiteralErrors.invalidError},
            {value: 0, valid: false, issue: IsLiteralErrors.invalidError},
        ]);
    });

    // ==================== orUndefined / orNull ====================

    describe('orUndefined', () => {
        enum Status {
            Active = 'active',
            Inactive = 'inactive'
        }

        const StatusSchema = IsEnum(Status);

        testValidation('accepts undefined', StatusSchema.orUndefined, [
            {value: undefined, valid: true},
            {value: 'active', valid: true},
            {value: null, valid: false, issue: GGIssueKey.required},
        ]);
    });

    describe('orNull', () => {
        enum Status {
            Active = 'active',
            Inactive = 'inactive'
        }

        const StatusSchema = IsEnum(Status);

        testValidation('accepts null', StatusSchema.orNull, [
            {value: null, valid: true},
            {value: 'active', valid: true},
            {value: undefined, valid: false, issue: GGIssueKey.required},
        ]);
    });

    // ==================== Refinement ====================

    describe('refine()', () => {
        enum Status {
            Pending = 'pending',
            Active = 'active',
            Completed = 'completed'
        }

        const IsActiveStatus = IsEnum(Status).refine(v => v === Status.Active, mustBeActiveError);

        it('accepts values passing refinement', () => {
            expect(IsActiveStatus.is('active')).toBe(true);
            expect(IsActiveStatus.is(Status.Active)).toBe(true);
        });

        it('rejects values failing refinement', () => {
            expect(IsActiveStatus.is('pending')).toBe(false);
            expect(IsActiveStatus.is('completed')).toBe(false);
        });

        it('adds correct error for failing refinement', () => {
            const issues = new GGIssuesList();
            expect(IsActiveStatus._parse('pending', issues, 'test')).toBeUndefined();
            expect(issues.getIssue(0)).toBe(mustBeActiveError);
        });
    });

    // ==================== Stringify ====================

    describe('stringify', () => {
        enum StringStatus {
            Pending = 'pending',
            Active = 'active'
        }

        enum NumericPriority {
            Low = 0,
            High = 1
        }

        testStringify('string enum', IsEnum(StringStatus), [
            {value: 'pending', expected: 'pending'},
            {value: 'active', expected: 'active'},
        ]);

        testStringify('numeric enum', IsEnum(NumericPriority), [
            {value: 0, expected: 0},
            {value: 1, expected: 1},
        ]);

        testStringify('orNull', IsEnum(StringStatus).orNull, [
            {value: 'active', expected: 'active'},
            {value: null, expected: null},
        ]);

        testStringify('orUndefined', IsEnum(StringStatus).orUndefined, [
            {value: 'pending', expected: 'pending'},
            // Note: undefined cannot be JSON stringified, so we only test defined values
        ]);
    });
});
