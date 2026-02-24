import {TestRunner} from "../../lib/TestRunner";

// Import generated validators (these come from typia generate)
import {
    isBigArray,
    isBigString,
    isDiscriminated,
    isNested,
    isNumberType,
    isRecursive,
    isRefine,
    isSimple,
    isStringifyBigArray,
    isStringifyBigString,
    isStringifyDiscriminated,
    isStringifyNested,
    isStringifyNumber,
    isStringifyRecursive,
    isStringifyRefine,
    isStringifySimple,
    isStringifyTuple,
    isTuple,
    validateBigArray,
    validateBigString,
    validateDiscriminated,
    validateNested,
    validateNumber,
    validateRecursive,
    validateRefine,
    validateSimple,
    validateTuple
} from "./generated/types";

// Typia Tester class - uses pre-generated validators
class TypiaTester extends TestRunner {

    private schema: {
        is: (data: unknown) => boolean
        validate: (data: unknown) => { success: boolean; data?: any; errors?: any[] }
        stringify: (data: unknown) => string | null
    }

    constructor(
        isFn: (data: unknown) => boolean,
        validateFn: (data: unknown) => { success: boolean; data?: any; errors?: any[] },
        stringifyFn: (data: unknown) => string | null
    ) {
        super();
        this.schema = {
            is: isFn,
            validate: validateFn,
            stringify: stringifyFn
        }
    }

    before(): void {
        // Typia doesn't need any setup
    }

    test_is(obj: unknown): boolean {
        return this.schema.is(obj);
    }

    test_parse(obj: unknown): any | undefined {
        const result = this.schema.validate(obj);
        return result.success ? result.data : undefined;
    }

    test_string(str: string | undefined): any | undefined {
        if (!str) return undefined;
        const obj = JSON.parse(str);
        const result = this.schema.validate(obj);
        return result.success ? result.data : undefined;
    }

    test_stringify(obj: any): string | undefined {
        return this.schema.stringify(obj) ?? undefined;
    }

    test_errorPaths(obj: unknown): string[] {
        const result = this.schema.validate(obj);
        return result.success ? [] : (result.errors?.map((e: any) => e.path?.replace(/^\$input\.?/, '') ?? '') ?? []);
    }
}

// Create library test cases
export default {
    number: new TypiaTester(isNumberType, validateNumber, isStringifyNumber),
    simple: new TypiaTester(isSimple, validateSimple, isStringifySimple),
    nested: new TypiaTester(isNested, validateNested, isStringifyNested),
    refine: new TypiaTester(isRefine, validateRefine, isStringifyRefine),
    discriminated: new TypiaTester(isDiscriminated, validateDiscriminated, isStringifyDiscriminated),
    recursive: new TypiaTester(isRecursive, validateRecursive, isStringifyRecursive),
    tuple: new TypiaTester(isTuple, validateTuple, isStringifyTuple),
    bigString: new TypiaTester(isBigString, validateBigString, isStringifyBigString),
    bigArray: new TypiaTester(isBigArray, validateBigArray, isStringifyBigArray)
};
