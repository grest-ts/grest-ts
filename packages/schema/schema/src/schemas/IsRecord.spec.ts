import {describe, expect, it} from 'vitest';
import {IsRecord} from './IsRecord';
import {IsString} from './IsString';
import {IsNumber} from './IsNumber';
import {IsObject} from './IsObject';
import {GGIssueKey} from "../issue/GGIssueKey";
import {GGIssuesList} from "../issue/GGIssuesList";
import {testObjectValidation, testStringify, testUtils} from "../utils/testUtils";
import {IsRecordErrors} from "../Errors";

// Define test issues outside utilsSpec to avoid double registration
const nonEmptyRecordError = new GGIssueKey('record_non_empty', 'Record must have at least one entry');

testUtils('IsRecord', () => {

    // ==================== Basic Validation ====================

    describe('basic validation', () => {
        const StringToNumber = IsRecord(IsString, IsNumber);

        testObjectValidation('validates records', StringToNumber, [
            {value: {}, valid: true},
            {value: {a: 1, b: 2, c: 3}, valid: true},
            {value: {key: 100}, valid: true},
        ]);

        testObjectValidation('rejects incorrect value types', StringToNumber, [
            {value: {a: 'not a number'}, valid: false, path: 'root.a'},
            {value: {a: 1, b: 'two'}, valid: false, path: 'root.b'},
        ]);

        testObjectValidation('rejects non-object values', StringToNumber, [
            {value: null, valid: false, issue: GGIssueKey.required},
            {value: undefined, valid: false, issue: GGIssueKey.required},
            {value: 'string', valid: false, issue: IsRecordErrors.typeError},
            {value: 123, valid: false, issue: IsRecordErrors.typeError},
            {value: [], valid: false, issue: IsRecordErrors.typeError},
        ]);
    });

    // ==================== Parse with Coercion ====================

    describe('parse with coercion', () => {
        const StringToNumber = IsRecord(IsString, IsNumber);

        it('coerces values when coerce flag is true', () => {
            const issues = new GGIssuesList();
            const result = StringToNumber._parse({a: '1', b: '2'}, issues, 'test', true);
            expect(result).toEqual({a: 1, b: 2});
            expect(issues.length).toBe(0);
        });

        it('fails if coercion fails', () => {
            const issues = new GGIssuesList();
            const result = StringToNumber._parse({a: 'not-a-number'}, issues, 'test', true);
            expect(result).toBeUndefined();
            expect(issues.length).toBeGreaterThan(0);
        });
    });

    // ==================== Key Validation ====================

    describe('key validation', () => {
        const LowercaseKeyRecord = IsRecord(
            IsString.regex(/^[a-z]+$/),
            IsNumber
        );

        testObjectValidation('validates keys against key schema', LowercaseKeyRecord, [
            {value: {abc: 1, def: 2}, valid: true},
            {value: {}, valid: true},
        ]);

        testObjectValidation('rejects invalid keys', LowercaseKeyRecord, [
            {value: {ABC: 1}, valid: false, path: 'root.ABC[key]'},
            {value: {abc123: 1}, valid: false, path: 'root.abc123[key]'},
        ]);
    });

    // ==================== Nested Records ====================

    describe('nested records', () => {
        const NestedRecord = IsRecord(
            IsString,
            IsRecord(IsString, IsNumber)
        );

        testObjectValidation('validates nested records', NestedRecord, [
            {value: {outer: {inner: 1}}, valid: true},
            {value: {a: {x: 1}, b: {y: 2}}, valid: true},
            {value: {}, valid: true},
        ]);

        testObjectValidation('rejects invalid nested records', NestedRecord, [
            {value: {outer: {inner: 'not a number'}}, valid: false, path: 'root.outer.inner'},
            {value: {outer: 'not an object'}, valid: false, path: 'root.outer'},
        ]);
    });

    // ==================== orUndefined / orNull ====================

    describe('orUndefined', () => {
        const StringToNumber = IsRecord(IsString, IsNumber);

        testObjectValidation('accepts undefined', StringToNumber.orUndefined, [
            {value: undefined, valid: true},
            {value: {a: 1}, valid: true},
            {value: null, valid: false, issue: GGIssueKey.required},
        ]);
    });

    describe('orNull', () => {
        const StringToNumber = IsRecord(IsString, IsNumber);

        testObjectValidation('accepts null', StringToNumber.orNull, [
            {value: null, valid: true},
            {value: {a: 1}, valid: true},
            {value: undefined, valid: false, issue: GGIssueKey.required},
        ]);
    });

    // ==================== Stringify ====================

    describe('stringify', () => {
        const StringToNumber = IsRecord(IsString, IsNumber);

        testStringify('basic record', StringToNumber, [
            {value: {a: 1, b: 2}, expected: {a: 1, b: 2}},
            {value: {}, expected: {}},
            {value: {key: 100}, expected: {key: 100}},
        ]);
    });

    describe('stringify nullable', () => {
        const StringToNumber = IsRecord(IsString, IsNumber).orNull;

        testStringify('nullable record', StringToNumber, [
            {value: {a: 1}, expected: {a: 1}},
            {value: null, expected: null},
        ]);
    });

    describe('stringify nested', () => {
        const NestedRecord = IsRecord(
            IsString,
            IsRecord(IsString, IsNumber)
        );

        testStringify('nested record', NestedRecord, [
            {value: {outer: {inner: 1}}, expected: {outer: {inner: 1}}},
            {value: {a: {x: 1}, b: {y: 2}}, expected: {a: {x: 1}, b: {y: 2}}},
        ]);
    });

    // ==================== Refinement ====================

    describe('refine()', () => {
        const NonEmptyRecord = IsRecord(IsString, IsNumber).refine(
            obj => Object.keys(obj).length > 0,
            nonEmptyRecordError
        );

        it('accepts values passing refinement', () => {
            expect(NonEmptyRecord.is({a: 1})).toBe(true);
            expect(NonEmptyRecord.is({a: 1, b: 2, c: 3})).toBe(true);
        });

        it('rejects values failing refinement', () => {
            expect(NonEmptyRecord.is({})).toBe(false);
        });

        it('adds correct error for failing refinement', () => {
            const issues = new GGIssuesList();
            expect(NonEmptyRecord._parse({}, issues, 'test')).toBeUndefined();
            expect(issues.getIssue(0)).toBe(nonEmptyRecordError);
        });
    });

    // ==================== Property Stripping ====================

    describe('strips extra properties from object values', () => {
        const UserSchema = IsObject({name: IsString, age: IsNumber});
        const UsersById = IsRecord(IsString, UserSchema);

        it('should strip extra properties from object values', () => {
            const issues = new GGIssuesList();
            const input = {
                user1: {name: 'John', age: 30, extra: 'ignored', password: 'secret'},
                user2: {name: 'Jane', age: 25, anotherExtra: true}
            };
            const result = UsersById._parse(input, issues, 'users');

            expect(issues.length).toBe(0);
            expect(result).toBeDefined();

            // Verify extra properties are stripped
            expect(result!['user1']).toEqual({name: 'John', age: 30});
            expect(result!['user2']).toEqual({name: 'Jane', age: 25});

            // Verify no extra keys
            expect(Object.keys(result!['user1'])).toEqual(['name', 'age']);
            expect(Object.keys(result!['user2'])).toEqual(['name', 'age']);
        });

        it('should strip extra properties in nested records of objects', () => {
            const TeamsByDepartment = IsRecord(
                IsString,
                IsRecord(IsString, UserSchema)
            );
            const issues = new GGIssuesList();
            const input = {
                engineering: {
                    lead: {name: 'John', age: 35, secret: 'hidden'},
                    dev: {name: 'Jane', age: 28, password: '123'}
                },
                sales: {
                    manager: {name: 'Bob', age: 40, apiKey: 'xyz'}
                }
            };
            const result = TeamsByDepartment._parse(input, issues, 'teams');

            expect(issues.length).toBe(0);
            expect(result).toBeDefined();
            expect(result!['engineering']['lead']).toEqual({name: 'John', age: 35});
            expect(result!['engineering']['dev']).toEqual({name: 'Jane', age: 28});
            expect(result!['sales']['manager']).toEqual({name: 'Bob', age: 40});
        });
    });

    // ==================== Defaults in Record Values ====================

    describe('defaults in record values', () => {
        const Entry = IsObject({
            name: IsString,
            score: IsNumber.orNull.default(0),
        });
        const Scores = IsRecord(IsString, Entry);

        it('applies defaults to each record value', () => {
            const issues = new GGIssuesList();
            const result = Scores._parse({
                alice: {name: "Alice", score: 100},
                bob: {name: "Bob", score: null},
            }, issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual({
                alice: {name: "Alice", score: 100},
                bob: {name: "Bob", score: 0},
            });
        });

        it('parse result always passes is()', () => {
            const issues = new GGIssuesList();
            const result = Scores._parse({
                x: {name: "X", score: null},
            }, issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(Scores.is(result)).toBe(true);
        });

        it('rejects record value with wrong type even when value has default fields', () => {
            const issues = new GGIssuesList();
            const result = Scores._parse({
                alice: {name: "Alice", score: null},
                bob: "not an object",
            }, issues, 'test', true);
            expect(result).toBeUndefined();
            expect(issues.length).toBeGreaterThan(0);
        });
    });
});
