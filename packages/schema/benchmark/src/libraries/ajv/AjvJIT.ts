/**
 * AJV JIT Tester
 *
 * Uses JIT compilation - schemas are compiled to validation functions at module load time.
 * This is NOT true AOT; the compilation happens at runtime when the module is imported.
 * For true AOT, see AjvAOT.ts which uses pre-generated standalone code.
 */
import {TestRunner} from "../../lib/TestRunner";
import Ajv, {ValidateFunction} from "ajv";
import {bigArraySchema, bigStringSchema, discriminatedSchema, nestedSchema, numberSchema, recursiveSchema, refineSchema, simpleSchema, tupleSchema} from "./data";
import {TestType} from "../../constants";

export class AjvJITTester extends TestRunner {
    private readonly validate: ValidateFunction;
    private preparedClone: any;  // Clone prepared before each iteration

    constructor(validate: ValidateFunction) {
        super();
        this.validate = validate;
    }

    before(): void {
    }

    // Called before each iteration, OUTSIDE the timed section
    prepare(type: TestType): void {
        // Clone the object that will be used - AJV mutates with removeAdditional
        // Use JSON parse/stringify - faster than structuredClone for our test objects
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
        // Use pre-cloned object (AJV mutates with removeAdditional)
        return this.validate(this.preparedClone);
    }

    test_parse(_obj: unknown): any | undefined {
        // Use pre-cloned object
        const valid = this.validate(this.preparedClone);
        return valid ? this.preparedClone : undefined;
    }

    test_string(str: string | undefined): any | undefined {
        if (!str) return undefined;
        const obj = JSON.parse(str);
        const valid = this.validate(obj);
        return valid ? obj : undefined;
    }

    test_stringify(_obj: any): any | undefined {
        // Use pre-cloned object
        const valid = this.validate(this.preparedClone);
        return valid ? JSON.stringify(this.preparedClone) : undefined;
    }

    test_errorPaths(obj: unknown): string[] {
        const clone = JSON.parse(JSON.stringify(obj));
        this.validate(clone);
        return this.validate.errors?.map(e => e.instancePath.replace(/^\//, '').replace(/\//g, '.')) ?? [];
    }
}

const ajv = new Ajv({
    allErrors: true,  // Collect all errors like other libraries
    removeAdditional: "all",
    discriminator: true  // Enable discriminator keyword for oneOf
});

export default {
    number: new AjvJITTester(ajv.compile(numberSchema)),
    simple: new AjvJITTester(ajv.compile(simpleSchema)),
    nested: new AjvJITTester(ajv.compile(nestedSchema)),
    refine: new AjvJITTester(ajv.compile(refineSchema)),
    discriminated: new AjvJITTester(ajv.compile(discriminatedSchema)),
    recursive: new AjvJITTester(ajv.compile(recursiveSchema)),
    tuple: new AjvJITTester(ajv.compile(tupleSchema)),
    bigString: new AjvJITTester(ajv.compile(bigStringSchema)),
    bigArray: new AjvJITTester(ajv.compile(bigArraySchema))
}