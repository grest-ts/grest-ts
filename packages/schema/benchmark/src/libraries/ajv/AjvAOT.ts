/**
 * AJV AOT Tester
 *
 * Uses pre-generated standalone validation code (true AOT compilation).
 * Run `tsx generate.ts` in this folder to generate validators.
 */
import { TestRunner } from "../../lib/TestRunner";
import { TestType } from "../../constants";
import type { ValidateFunction } from "ajv";

// Import pre-generated AOT validators
// @ts-ignore
import * as validators from "./generated/validators.js";

export class AjvAOTTester extends TestRunner {
    private readonly validate: ValidateFunction;
    private preparedClone: any;

    constructor(validate: ValidateFunction) {
        super();
        this.validate = validate;
    }

    before(): void {
    }

    prepare(type: TestType): void {
        // Clone the object - AJV mutates with removeAdditional
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
        return this.validate(this.preparedClone);
    }

    test_parse(_obj: unknown): any | undefined {
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
        const valid = this.validate(this.preparedClone);
        return valid ? JSON.stringify(this.preparedClone) : undefined;
    }

    test_errorPaths(obj: unknown): string[] {
        const clone = JSON.parse(JSON.stringify(obj));
        this.validate(clone);
        return this.validate.errors?.map(e => e.instancePath.replace(/^\//, '').replace(/\//g, '.')) ?? [];
    }
}

export default {
    number: new AjvAOTTester(validators.number as ValidateFunction),
    simple: new AjvAOTTester(validators.simple as ValidateFunction),
    nested: new AjvAOTTester(validators.nested as ValidateFunction),
    refine: new AjvAOTTester(validators.refine as ValidateFunction),
    discriminated: new AjvAOTTester(validators.discriminated as ValidateFunction),
    recursive: new AjvAOTTester(validators.recursive as ValidateFunction),
    tuple: new AjvAOTTester(validators.tuple as ValidateFunction),
    bigString: new AjvAOTTester(validators.bigString as ValidateFunction),
    bigArray: new AjvAOTTester(validators.bigArray as ValidateFunction)
};
