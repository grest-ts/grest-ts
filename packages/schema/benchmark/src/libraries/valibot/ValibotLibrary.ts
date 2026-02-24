import * as v from "valibot";
import {TestRunner} from "../../lib/TestRunner";
import {createBigArraySchema, createBigStringSchema, createDiscriminatedSchema, createNestedSchema, createRecursiveSchema, createRefineSchema, createSimpleSchema, createTupleSchema} from "./data";

class ValibotTester<T extends v.GenericSchema> extends TestRunner {
    private readonly schema: T;

    constructor(schema: T) {
        super();
        this.schema = schema;
    }

    before(): void {
    }

    test_is(obj: unknown): boolean {
        return v.safeParse(this.schema, obj).success;
    }

    test_parse(obj: unknown): any | undefined {
        const result = v.safeParse(this.schema, obj);
        return result.success ? result.output : undefined;
    }

    test_string(str: string | undefined): any | undefined {
        if (!str) return undefined;
        const obj = JSON.parse(str);
        const result = v.safeParse(this.schema, obj);
        return result.success ? result.output : undefined;
    }

    test_stringify(obj: any): any | undefined {
        const result = v.safeParse(this.schema, obj);
        return result.success ? JSON.stringify(result.output) : undefined;
    }

    test_errorPaths(obj: unknown): string[] {
        const result = v.safeParse(this.schema, obj);
        return result.success ? [] : result.issues.map(i => i.path?.map(p => p.key).join('.') ?? '');
    }
}

export default {
    number: new ValibotTester(v.pipe(v.number(), v.finite())),
    simple: new ValibotTester(createSimpleSchema()),
    nested: new ValibotTester(createNestedSchema()),
    refine: new ValibotTester(createRefineSchema()),
    discriminated: new ValibotTester(createDiscriminatedSchema()),
    recursive: new ValibotTester(createRecursiveSchema()),
    tuple: new ValibotTester(createTupleSchema()),
    bigString: new ValibotTester(createBigStringSchema()),
    bigArray: new ValibotTester(createBigArraySchema())
};
