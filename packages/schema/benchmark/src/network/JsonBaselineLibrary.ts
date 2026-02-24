import {GGBenchTestCases, TestRunner, SKIP, SkipType} from "../lib/TestRunner";
import GGTypeAOT from "../libraries/gg-type/GGTypeAOT";

/**
 * JSON library with validation.
 * Network input/output is Buffer (like binary formats) for fair comparison.
 */
class JsonTester extends TestRunner {
    private validator: TestRunner;

    constructor(validator: TestRunner) {
        // For JSON, network input is Buffer (like binary formats for fair comparison)
        super((correctObj, wrongObj) => ({
            correctNetworkInput: Buffer.from(JSON.stringify(correctObj), 'utf-8'),
            wrongNetworkInput: Buffer.from(JSON.stringify(wrongObj), 'utf-8')
        }));
        this.validator = validator;
    }

    before(): void {}

    test_is(obj: unknown): boolean | SkipType {
        const result = this.validator.test_is(obj);
        return result !== SKIP && result === true;
    }

    test_parse(obj: any): any | undefined {
        // Decode Buffer to string, then parse JSON, then validate
        const decoded = JSON.parse(obj.toString('utf-8'));
        return this.validator.test_parse(decoded);
    }

    test_string(_str: string | undefined): SkipType {
        // Network libraries don't use string - they use binary _parse
        return SKIP;
    }

    test_stringify(obj: any): any | undefined {
        // Validate and strip extra properties, then encode to Buffer
        const cleaned = this.validator.test_parse(obj);
        if (cleaned === undefined) return undefined;
        return Buffer.from(JSON.stringify(cleaned), 'utf-8');
    }

    test_errorPaths(obj: unknown): string[] | SkipType {
        return this.validator.test_errorPaths(obj);
    }
}

export default {
    number: new JsonTester(GGTypeAOT.number!),
    simple: new JsonTester(GGTypeAOT.simple!),
    nested: new JsonTester(GGTypeAOT.nested!),
    refine: new JsonTester(GGTypeAOT.refine!),
    discriminated: new JsonTester(GGTypeAOT.discriminated!),
    recursive: new JsonTester(GGTypeAOT.recursive!),
    tuple: new JsonTester(GGTypeAOT.tuple!),
    bigString: new JsonTester(GGTypeAOT.bigString!),
    bigArray: new JsonTester(GGTypeAOT.bigArray!)
} satisfies GGBenchTestCases;
