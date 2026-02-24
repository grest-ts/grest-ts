import {Packr} from 'msgpackr';
import {GGBenchTestCases, TestRunner, SKIP, SkipType} from "../lib/TestRunner";
import GGTypeAOT from "../libraries/gg-type/GGTypeAOT";

// Use record extension for faster encoding (caches object structure)
const packr = new Packr({useRecords: true});

/**
 * MessagePack library with validation.
 */
class MsgpackTester extends TestRunner {
    private validator: TestRunner;

    constructor(validator: TestRunner) {
        super((correctObj, wrongObj) => ({
            correctNetworkInput: packr.encode(correctObj),
            wrongNetworkInput: packr.encode(wrongObj)
        }));
        this.validator = validator;
    }

    before(): void {}

    test_is(obj: unknown): boolean | SkipType {
        const result = this.validator.test_is(obj);
        return result !== SKIP && result === true;
    }

    test_parse(obj: any): any | undefined {
        const decoded = packr.decode(obj);
        return this.validator.test_parse(decoded);
    }

    test_string(_str: string | undefined): SkipType {
        // Network libraries don't use string - they use binary _parse
        return SKIP;
    }

    test_stringify(obj: any): any | undefined {
        const cleaned = this.validator.test_parse(obj);
        if (cleaned === undefined) return undefined;
        return packr.encode(cleaned);
    }

    test_errorPaths(obj: unknown): string[] | SkipType {
        return this.validator.test_errorPaths(obj);
    }
}

export default {
    number: new MsgpackTester(GGTypeAOT.number!),
    simple: new MsgpackTester(GGTypeAOT.simple!),
    nested: new MsgpackTester(GGTypeAOT.nested!),
    refine: new MsgpackTester(GGTypeAOT.refine!),
    discriminated: new MsgpackTester(GGTypeAOT.discriminated!),
    recursive: new MsgpackTester(GGTypeAOT.recursive!),
    tuple: new MsgpackTester(GGTypeAOT.tuple!),
    bigString: new MsgpackTester(GGTypeAOT.bigString!),
    bigArray: new MsgpackTester(GGTypeAOT.bigArray!)
} satisfies GGBenchTestCases;
