import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {GGSchema} from "../GGSchema";
import {GGIssuesList} from "../issue/GGIssuesList";
import {GGIssueKey} from "../issue/GGIssueKey";
import {AOTExecutor} from "../executor/aot/AOTExecutor";
import {StandardExecutor} from "../executor/standard/StandardExecutor";

export function testUtils(name: string, tests: () => void) {
    [true, false].forEach((useCompiled) => {
        describe(`${name} (USE_COMPILED=${useCompiled})`, () => {
            beforeAll(() => {
                GGSchema.EXECUTOR = useCompiled ? AOTExecutor.instance : StandardExecutor.instance;
            });
            tests();
        })
    });
    afterAll(() => {
        GGSchema.EXECUTOR = AOTExecutor.instance;
    });
}

function label(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'number' && isNaN(value)) return 'NaN';
    return JSON.stringify(value);
}

interface ValidationCase {
    value: unknown;
    valid: boolean;
    issue?: GGIssueKey<any>;
}

export function testValidation(name: string, schema: GGSchema<any>, cases: ValidationCase[]) {
    describe(name, () => {
        cases.forEach(({value, valid, issue}) => {
            it(`${label(value)} → ${valid ? 'valid' : issue.code}`, () => {
                expect(schema.is(value)).toBe(valid);

                const issues = new GGIssuesList();
                const result = schema._parse(value, issues, 'test');
                if (valid) {
                    expect(result).toStrictEqual(value);
                    expect(issues.length).toBe(0);
                } else {
                    expect(result).toBeUndefined();
                    expect(issues.getIssue(0)?.code).toBe(issue.code);
                }

                if (valid) {
                    expect(() => schema.assert(value)).not.toThrow();
                } else {
                    expect(() => schema.assert(value)).toThrow();
                }
            });
        });
    });
}

interface CoercionCase {
    value: unknown;
    result: any;
    issue?: GGIssueKey<any>;
}

export function testCoercion(name: string, schema: GGSchema<any>, cases: CoercionCase[]) {
    describe(name, () => {
        cases.forEach(({value, result, issue}) => {
            it(`${label(value)} → ${result ?? issue.code}`, () => {
                const issues = new GGIssuesList();
                const parsed = schema._parse(value, issues, 'test', true);
                if (result !== undefined) {
                    expect(parsed).toBe(result);
                    expect(issues.length).toBe(0);
                } else {
                    expect(parsed).toBeUndefined();
                    expect(issues.getIssue(0)?.code).toBe(issue.code);
                }
            });
        });
    });
}

interface ObjectValidationCase {
    value: unknown;
    valid: boolean;
    issue?: GGIssueKey<any>;
    path?: string;
}

export function testObjectValidation(name: string, schema: GGSchema<any>, cases: ObjectValidationCase[]) {
    describe(name, () => {
        cases.forEach(({value, valid, issue, path}) => {
            const desc = valid ? 'valid' : (issue ? issue.code : 'invalid');
            it(`${label(value)} → ${desc}`, () => {
                expect(schema.is(value)).toBe(valid);

                const issues = new GGIssuesList();
                const result = schema._parse(value, issues, 'root');
                if (valid) {
                    // parse() returns only schema-defined keys
                    // For orUndefined schemas, undefined is valid and returns undefined
                    // For orNull schemas, null is valid and returns null
                    expect(issues.length).toBe(0);
                    if (value === undefined || value === null) {
                        expect(result).toBe(value);
                    }
                } else {
                    expect(result).toBeUndefined();
                    if (issue) {
                        expect(issues.getIssue(0)?.code).toBe(issue.code);
                    }
                    if (path) {
                        expect(issues.getPath(0)).toBe(path);
                    }
                }
            });
        });
    });
}

interface StringifyCase {
    value: any;
    expected: any;
}

export function testStringify(name: string, schema: GGSchema<any>, cases: StringifyCase[]) {
    describe(name, () => {
        cases.forEach(({value, expected}) => {
            it(`stringify ${label(value)}`, () => {
                const result = schema.stringify(value);
                const parsed = JSON.parse(result!);
                expect(parsed).toEqual(expected);
                // For objects, also verify no extra keys
                if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
                    expect(Object.keys(parsed).sort()).toEqual(Object.keys(expected).sort());
                }
            });
        });
    });
}
