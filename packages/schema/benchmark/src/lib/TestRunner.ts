// ============ Skip Symbol ============

import {TestType} from "../constants";

export const SKIP = Symbol('SKIP');
export type SkipType = typeof SKIP;

// ============ Recursive Data Type ============

export interface RecursiveData {
    name: string;
    value: number;
    children?: RecursiveData[];
}

// ============ Test Type Enum ============

// ============ Test Data Definition ============

export interface TestDataDefinition<T> {
    category: string;
    correctObj: T & { EXTRA?: string };
    wrongObj: T & any;
    /** Expected error paths in wrongObj (for "all errors" check) */
    expectedErrorPaths: string[];
}

// ============ Library Test Cases ============

export interface GGBenchTestCases {
    number?: TestRunner;
    simple?: TestRunner;
    nested?: TestRunner;
    refine?: TestRunner;
    discriminated?: TestRunner;
    recursive?: TestRunner;
    tuple?: TestRunner;
    bigString?: TestRunner;
    bigArray?: TestRunner;
}

// ============ Base Tester Class ============

export type tTestObj = object;

export type CreateNetworkDataFunction = (correctObj: tTestObj, wrongObj: tTestObj) => { correctNetworkInput: any, wrongNetworkInput: any };

export abstract class TestRunner {

    // Original objects (always stored) - protected for subclass access (e.g., AJV cloning)
    protected originalCorrectObj: tTestObj | undefined;
    protected originalWrongObj: tTestObj | undefined;
    // For network libs: encoded data for _parse; for validation libs: same as original
    protected correctObj: tTestObj | undefined;
    protected wrongObj: tTestObj | undefined;
    // JSON strings for parseString tests
    protected correctJsonString: string | undefined;
    protected wrongJsonString: string | undefined;

    constructor(codec?: CreateNetworkDataFunction) {
        this.codec = codec;
    }

    public setObj(correctObj: tTestObj, wrongObj: tTestObj) {
        // Always store original objects
        this.originalCorrectObj = correctObj;
        this.originalWrongObj = wrongObj;

        // Store JSON strings for parseString tests
        this.correctJsonString = JSON.stringify(correctObj);
        this.wrongJsonString = JSON.stringify(wrongObj);

        if (this.codec) {
            // Network libraries: store encoded form for _parse
            const {correctNetworkInput, wrongNetworkInput} = this.codec(correctObj, wrongObj);
            this.correctObj = correctNetworkInput;
            this.wrongObj = wrongNetworkInput;
        } else {
            // Validation libraries: use original
            this.correctObj = correctObj;
            this.wrongObj = wrongObj;
        }
    }

    /**
     * Called before each iteration to prepare data (e.g., clone objects).
     * Override this for libraries that mutate input (like AJV).
     * This is called OUTSIDE the timed section.
     */
    public prepare(_type: TestType): void {
        // Default: no preparation needed
    }

    public run(type: TestType): any | undefined {
        switch (type) {
            // Validation operations
            case TestType.is_correct:
                return this.test_is(this.originalCorrectObj);
            case TestType.is_wrong:
                return this.test_is(this.originalWrongObj);
            // Parse: network libs get encoded data, validation libs get original
            case TestType.parse_correct:
                return this.test_parse(this.correctObj);
            case TestType.parse_wrong:
                return this.test_parse(this.wrongObj);
            // String: JSON string -> validated object (includes JSON.parse + validation)
            case TestType.string_correct:
                return this.test_string(this.correctJsonString);
            case TestType.string_wrong:
                return this.test_string(this.wrongJsonString);
            // Stringify: always use original object (even for network libs)
            case TestType.stringify_correct:
                return this.test_stringify(this.originalCorrectObj);
            case TestType.stringify_wrong:
                return this.test_stringify(this.originalWrongObj);
        }
    }

    private readonly codec?: CreateNetworkDataFunction;

    /**
     * Called before running tests. Libraries can set up state here.
     */
    abstract before(): void;

    /**
     * Check if object is valid (type guard).
     * Return SKIP if library doesn't support is/check operations.
     */
    abstract test_is(obj: unknown): boolean | SkipType;

    /**
     * Parse/validate an already-decoded object.
     * Return the validated object (with extra props stripped), undefined if invalid, or SKIP if not supported.
     */
    abstract test_parse(obj: unknown): any | undefined | SkipType;

    /**
     * Parse JSON string and validate: JSON.parse + validation in one step.
     * Return the validated object, undefined if invalid, or SKIP if not supported.
     */
    abstract test_string(str: string | undefined): any | undefined | SkipType;

    /**
     * Validate object and prepare for encoding (strip extra props, etc.)
     * Return the validated object, undefined if invalid, or SKIP if not supported.
     */
    abstract test_stringify(obj: any): any | undefined | SkipType;

    /**
     * Get validation error paths from an invalid object.
     * Used to verify library reports ALL errors, not just the first.
     * Return array of error paths (e.g., ["name", "age", "email"]), or SKIP if not supported.
     */
    abstract test_errorPaths(obj: unknown): string[] | SkipType;

}
