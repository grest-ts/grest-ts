import {SKIP, SkipType, TestRunner} from "../../lib/TestRunner";

// Import generated validators (these come from ts-runtime-checks transform)
// Using .js extension for ESM compatibility with compiled output
import {
    isNumber,
    isSimple,
    isNested,
    isRecursive,
    isTuple,
    isBigString,
    isBigArray,
    parseNumber,
    parseSimple,
    parseNested,
    parseRecursive,
    parseTuple,
    parseBigString,
    parseBigArray,
    stringifyNumber,
    stringifySimple,
    stringifyNested,
    stringifyRecursive,
    stringifyTuple,
    stringifyBigString,
    stringifyBigArray
} from "./generated/types";

// ts-runtime-checks Tester class - uses pre-generated validators
class TsRuntimeChecksTester extends TestRunner {

    private schema: {
        is: (data: unknown) => boolean
        parse: (data: unknown) => any | undefined
        stringify: (data: unknown) => string | null
    }

    constructor(
        isFn: (data: unknown) => boolean,
        parseFn: (data: unknown) => any | undefined,
        stringifyFn: (data: unknown) => string | null
    ) {
        super();
        this.schema = {
            is: isFn,
            parse: parseFn,
            stringify: stringifyFn
        }
    }

    before(): void {
        // ts-runtime-checks doesn't need any setup
    }

    test_is(obj: unknown): boolean {
        return this.schema.is(obj);
    }

    test_parse(_obj: unknown): SkipType {
        // ts-runtime-checks is first-error-only, can't collect all errors
        // return this.schema.parse(obj);
        return SKIP;
    }

    test_string(_str: string | undefined): SkipType {
        // ts-runtime-checks is first-error-only, can't collect all errors
        // if (!str) return undefined;
        // const obj = JSON.parse(str);
        // return this.schema.parse(obj);
        return SKIP;
    }

    test_stringify(obj: any): string | undefined {
        return this.schema.stringify(obj) ?? undefined;
    }

    test_errorPaths(_obj: unknown): SkipType {
        // ts-runtime-checks is first-error-only - skip error paths validation
        return SKIP;
    }
}

// Skipped tester for unsupported features
// ts-runtime-checks limitations:
// - No constraint validation (min/max, pattern, minLength, etc.) - only TypeScript types
// - Discriminated unions not properly validated (only checks if object, not the variants)
class SkippedTester extends TestRunner {
    before(): void {
    }

    test_is(_obj: unknown): SkipType {
        return SKIP;
    }

    test_parse(_obj: unknown): SkipType {
        return SKIP;
    }

    test_string(_str: string | undefined): SkipType {
        return SKIP;
    }

    test_stringify(_obj: any): SkipType {
        return SKIP;
    }

    test_errorPaths(_obj: unknown): SkipType {
        return SKIP;
    }
}

// Create library test cases
// ts-runtime-checks limitations (marked as N/A):
// - refine: Cannot handle complex regex with escaping (password pattern broken)
// - discriminated: Unions not properly validated (only checks typeof === "object")
export default {
    number: new TsRuntimeChecksTester(isNumber, parseNumber, stringifyNumber),
    simple: new TsRuntimeChecksTester(isSimple, parseSimple, stringifySimple),
    nested: new TsRuntimeChecksTester(isNested, parseNested, stringifyNested),
    refine: new SkippedTester(),  // Complex regex escaping broken
    discriminated: new SkippedTester(),  // Union variants not validated
    recursive: new TsRuntimeChecksTester(isRecursive, parseRecursive, stringifyRecursive),
    tuple: new TsRuntimeChecksTester(isTuple, parseTuple, stringifyTuple),
    bigString: new TsRuntimeChecksTester(isBigString, parseBigString, stringifyBigString),
    bigArray: new TsRuntimeChecksTester(isBigArray, parseBigArray, stringifyBigArray)
};
