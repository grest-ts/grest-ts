import {describe, expect, it} from "vitest";
import {GGIssuesList} from "../issue/GGIssuesList";
import {IsObject} from "./IsObject";
import {IsString} from "./IsString";
import {IsNumber} from "./IsNumber";
import {IsBoolean} from "./IsBoolean";
import {IsArray} from "./IsArray";
import {IsTuple} from "./IsTuple";
import {testUtils} from "../utils/testUtils";

/**
 * Tests for error collection behavior across both executors.
 *
 * These tests ensure that AOTExecutor collects errors identically to StandardExecutor.
 * They specifically test for regressions in:
 *
 * 1. Operator precedence bug: The generated code joins field checks with `&` (bitwise AND),
 *    but individual checks use `&&` (logical AND). Due to precedence (`&` binds tighter),
 *    expressions like `A&&B&C&&D` could be parsed as `A && (B & C) && D`, causing
 *    short-circuit behavior when it shouldn't. Fix: wrap each field check in parentheses.
 *
 * 2. Tuple length error behavior: When tuple length is wrong, only the length error
 *    should be reported, not individual missing element errors. This matches
 *    CODE_Validate's early-return behavior.
 */

testUtils('Error Collection', () => {

    describe('Object field error collection', () => {
        // This test catches the operator precedence bug where `&` and `&&` interact incorrectly

        const Schema = IsObject({
            name: IsString,
            age: IsNumber,
            email: IsString,
            active: IsBoolean,
            tags: IsArray(IsString)
        });

        const wrongObj = {
            name: 123,           // wrong type (string expected)
            age: 'not-a-number', // wrong type (number expected)
            // email missing      // required field missing
            active: 'yes',      // wrong type (boolean expected)
            tags: 'not-array'   // wrong type (array expected)
        };

        it('should collect exactly 5 errors for 5 invalid fields', () => {
            const issues = new GGIssuesList();
            Schema._parse(wrongObj, issues, '');

            expect(issues.length).toBe(5);
        });

        it('should report errors for all invalid fields', () => {
            const issues = new GGIssuesList();
            Schema._parse(wrongObj, issues, '');

            const paths = [];
            for (let i = 0; i < issues.length; i++) {
                paths.push(issues.getPath(i));
            }

            expect(paths).toContain('name');
            expect(paths).toContain('age');
            expect(paths).toContain('email');
            expect(paths).toContain('active');
            expect(paths).toContain('tags');
        });
    });

    describe('Nested object error collection', () => {
        // Tests that nested objects also collect all errors correctly

        const Schema = IsObject({
            user: IsObject({
                firstName: IsString,
                lastName: IsString,
                age: IsNumber
            }),
            settings: IsObject({
                theme: IsString,
                notifications: IsBoolean
            })
        });

        const wrongObj = {
            user: {
                firstName: 123,        // wrong type
                lastName: null as any,        // null for required field
                age: 'invalid'         // wrong type
            },
            settings: {
                theme: true,           // wrong type
                notifications: 'yes'   // wrong type
            }
        };

        it('should collect exactly 5 errors from nested fields', () => {
            const issues = new GGIssuesList();
            Schema._parse(wrongObj, issues, '');

            expect(issues.length).toBe(5);
        });

        it('should report correct nested paths', () => {
            const issues = new GGIssuesList();
            Schema._parse(wrongObj, issues, '');

            const paths = [];
            for (let i = 0; i < issues.length; i++) {
                paths.push(issues.getPath(i));
            }

            expect(paths).toContain('user.firstName');
            expect(paths).toContain('user.lastName');
            expect(paths).toContain('user.age');
            expect(paths).toContain('settings.theme');
            expect(paths).toContain('settings.notifications');
        });
    });

    describe('Tuple length error behavior', () => {
        // This test ensures tuple length errors don't also report missing element errors

        const Schema = IsTuple(IsNumber, IsNumber, IsNumber);

        it('should report only length error when tuple is too short', () => {
            const issues = new GGIssuesList();
            Schema._parse([1, 2], issues, ''); // Missing 3rd element

            // Should only report length error, NOT missing element at index 2
            expect(issues.length).toBe(1);
            expect(issues.getIssue(0)?.code).toBe('invalid.tuple.length');
        });

        it('should report only length error when tuple is too long', () => {
            const issues = new GGIssuesList();
            Schema._parse([1, 2, 3, 4], issues, ''); // Extra element

            expect(issues.length).toBe(1);
            expect(issues.getIssue(0)?.code).toBe('invalid.tuple.length');
        });
    });

    describe('Tuple element type errors', () => {
        const Schema = IsTuple(IsNumber, IsNumber, IsNumber);

        it('should collect all element type errors when length is correct', () => {
            const issues = new GGIssuesList();
            Schema._parse(['a', 'b', 'c'], issues, ''); // All wrong types

            expect(issues.length).toBe(3);
        });

        it('should report errors for each invalid element', () => {
            const issues = new GGIssuesList();
            Schema._parse(['a', 2, 'c'], issues, ''); // Index 0 and 2 wrong

            expect(issues.length).toBe(2);

            const paths = [];
            for (let i = 0; i < issues.length; i++) {
                paths.push(issues.getPath(i));
            }

            // Path format may be '0' or '.0' depending on executor
            expect(paths.some(p => p === '0' || p === '.0')).toBe(true);
            expect(paths.some(p => p === '2' || p === '.2')).toBe(true);
        });
    });

    describe('Object with tuple fields', () => {
        // Combined test: object with multiple tuple fields

        const Schema = IsObject({
            coords: IsTuple(IsNumber, IsNumber, IsNumber),
            range: IsTuple(IsNumber, IsNumber),
            mixed: IsTuple(IsString, IsNumber, IsBoolean)
        });

        const wrongObj = {
            coords: [10.5, 20.3],          // Missing element
            range: [0, 'hundred'],          // Wrong type at index 1
            mixed: ['hello', 42, 'not-bool'] // Wrong type at index 2
        };

        it('should collect exactly 3 errors', () => {
            const issues = new GGIssuesList();
            Schema._parse(wrongObj, issues, '');

            // coords: 1 length error
            // range: 1 type error at index 1
            // mixed: 1 type error at index 2
            expect(issues.length).toBe(3);
        });

        it('should report correct paths', () => {
            const issues = new GGIssuesList();
            Schema._parse(wrongObj, issues, '');

            const paths = [];
            for (let i = 0; i < issues.length; i++) {
                paths.push(issues.getPath(i));
            }

            expect(paths).toContain('coords');
            expect(paths).toContain('range.1');
            expect(paths).toContain('mixed.2');
        });
    });

    describe('Array element error collection', () => {
        // Tests that array element errors are collected correctly

        const Schema = IsArray(IsNumber);

        it('should collect errors for all invalid elements', () => {
            const issues = new GGIssuesList();
            Schema._parse(['a', 'b', 'c', 'd', 'e'], issues, '');

            expect(issues.length).toBe(5);
        });

        it('should report correct paths for each invalid element', () => {
            const issues = new GGIssuesList();
            Schema._parse([1, 'a', 3, 'b', 5], issues, ''); // Index 1 and 3 wrong

            expect(issues.length).toBe(2);

            const paths = [];
            for (let i = 0; i < issues.length; i++) {
                paths.push(issues.getPath(i));
            }

            expect(paths).toContain('1');
            expect(paths).toContain('3');
        });
    });

    describe('Many fields stress test', () => {
        // Stress test with many fields to ensure the precedence fix works at scale

        const Schema = IsObject({
            field1: IsString,
            field2: IsNumber,
            field3: IsBoolean,
            field4: IsString,
            field5: IsNumber,
            field6: IsBoolean,
            field7: IsString,
            field8: IsNumber,
            field9: IsBoolean,
            field10: IsString
        });

        const allWrong = {
            field1: 1,
            field2: 'wrong',
            field3: 'wrong',
            field4: 2,
            field5: 'wrong',
            field6: 'wrong',
            field7: 3,
            field8: 'wrong',
            field9: 'wrong',
            field10: 4
        };

        it('should collect exactly 10 errors', () => {
            const issues = new GGIssuesList();
            Schema._parse(allWrong, issues, '');

            expect(issues.length).toBe(10);
        });

        it('should report errors for all 10 fields', () => {
            const issues = new GGIssuesList();
            Schema._parse(allWrong, issues, '');

            const paths = [];
            for (let i = 0; i < issues.length; i++) {
                paths.push(issues.getPath(i));
            }

            for (let i = 1; i <= 10; i++) {
                expect(paths).toContain(`field${i}`);
            }
        });
    });
});
