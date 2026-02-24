import {Encoder} from 'cbor-x';
import {GGBenchTestCases, TestRunner, SKIP, SkipType} from "../lib/TestRunner";
import GGTypeAOT from "../libraries/gg-type/GGTypeAOT";

// Use record extension for faster encoding (caches object structure)
const encoder = new Encoder({useRecords: true});

/**
 * CBOR-X library with validation.
 */
class CborXTester extends TestRunner {
    private validator: TestRunner;

    constructor(validator: TestRunner) {
        super((correctObj, wrongObj) => ({
            correctNetworkInput: encoder.encode(correctObj),
            wrongNetworkInput: encoder.encode(wrongObj)
        }));
        this.validator = validator;
    }

    before(): void {}

    test_is(obj: unknown): boolean | SkipType {
        const result = this.validator.test_is(obj);
        return result !== SKIP && result === true;
    }

    test_parse(obj: any): any | undefined {
        const decoded = encoder.decode(obj);
        return this.validator.test_parse(decoded);
    }

    test_string(_str: string | undefined): SkipType {
        // Network libraries don't use string - they use binary _parse
        return SKIP;
    }

    test_stringify(obj: any): any | undefined {
        const cleaned = this.validator.test_parse(obj);
        if (cleaned === undefined) return undefined;
        return encoder.encode(cleaned);
    }

    test_errorPaths(obj: unknown): string[] | SkipType {
        return this.validator.test_errorPaths(obj);
    }
}

export default {
    number: new CborXTester(GGTypeAOT.number!),
    simple: new CborXTester(GGTypeAOT.simple!),
    nested: new CborXTester(GGTypeAOT.nested!),
    refine: new CborXTester(GGTypeAOT.refine!),
    discriminated: new CborXTester(GGTypeAOT.discriminated!),
    recursive: new CborXTester(GGTypeAOT.recursive!),
    tuple: new CborXTester(GGTypeAOT.tuple!),
    bigString: new CborXTester(GGTypeAOT.bigString!),
    bigArray: new CborXTester(GGTypeAOT.bigArray!)
} satisfies GGBenchTestCases;
