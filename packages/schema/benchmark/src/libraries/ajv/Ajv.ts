import {TestRunner} from "../../lib/TestRunner";
import Ajv from "ajv";
import {bigArraySchema, bigStringSchema, discriminatedSchema, nestedSchema, numberSchema, recursiveSchema, refineSchema, simpleSchema, tupleSchema} from "./data";
import {TestType} from "../../constants";

export class AjvNoCompileTester extends TestRunner {
    private readonly schema: object;
    private preparedClone: any;

    constructor(schema: object) {
        super();
        this.schema = schema;
    }

    before(): void {
    }

    prepare(type: TestType): void {
        // Use JSON parse - faster than structuredClone for our test objects
        switch (type) {
            case TestType.is_correct:
            case TestType.parse_correct:
            case TestType.stringify_correct:
                this.preparedClone = JSON.parse(this.correctJsonString!);
                break;
            case TestType.is_wrong:
            case TestType.parse_wrong:
            case TestType.stringify_wrong:
                this.preparedClone = JSON.parse(this.wrongJsonString!);
                break;
        }
    }

    test_is(_obj: unknown): boolean {
        return ajv.validate(this.schema, this.preparedClone);
    }

    test_parse(_obj: unknown): any | undefined {
        const valid = ajv.validate(this.schema, this.preparedClone);
        return valid ? this.preparedClone : undefined;
    }

    test_string(str: string | undefined): any | undefined {
        if (!str) return undefined;
        const obj = JSON.parse(str);
        const valid = ajv.validate(this.schema, obj);
        return valid ? obj : undefined;
    }

    test_stringify(_obj: any): any | undefined {
        const valid = ajv.validate(this.schema, this.preparedClone);
        return valid ? JSON.stringify(this.preparedClone) : undefined;
    }

    test_errorPaths(obj: unknown): string[] {
        const clone = JSON.parse(JSON.stringify(obj));
        ajv.validate(this.schema, clone);
        return ajv.errors?.map(e => e.instancePath.replace(/^\//, '').replace(/\//g, '.')) ?? [];
    }
}

const ajv = new Ajv({
    allErrors: true,  // Collect all errors like other libraries
    removeAdditional: "all",
    discriminator: true  // Enable discriminator keyword for oneOf
});

export default {
    number: new AjvNoCompileTester(numberSchema),
    simple: new AjvNoCompileTester(simpleSchema),
    nested: new AjvNoCompileTester(nestedSchema),
    refine: new AjvNoCompileTester(refineSchema),
    discriminated: new AjvNoCompileTester(discriminatedSchema),
    recursive: new AjvNoCompileTester(recursiveSchema),
    tuple: new AjvNoCompileTester(tupleSchema),
    bigString: new AjvNoCompileTester(bigStringSchema),
    bigArray: new AjvNoCompileTester(bigArraySchema)
};
