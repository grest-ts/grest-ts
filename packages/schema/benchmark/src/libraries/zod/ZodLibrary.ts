import {z} from "zod";
import {TestRunner} from "../../lib/TestRunner";
import {createBigArraySchema, createBigStringSchema, createDiscriminatedSchema, createNestedSchema, createRecursiveSchema, createRefineSchema, createSimpleSchema, createTupleSchema} from "./data";

class ZodTester<T extends z.ZodTypeAny> extends TestRunner {
    private readonly schema: T;

    constructor(schema: T) {
        super();
        this.schema = schema;
    }

    before(): void {
    }

    test_is(obj: unknown): boolean {
        return this.schema.safeParse(obj).success;
    }

    test_parse(obj: unknown): any | undefined {
        const result = this.schema.safeParse(obj);
        return result.success ? result.data : undefined;
    }

    test_string(str: string | undefined): any | undefined {
        if (!str) return undefined;
        const obj = JSON.parse(str);
        const result = this.schema.safeParse(obj);
        return result.success ? result.data : undefined;
    }

    test_stringify(obj: any): any | undefined {
        const result = this.schema.safeParse(obj);
        return result.success ? JSON.stringify(result.data) : undefined;
    }

    test_errorPaths(obj: unknown): string[] {
        const result = this.schema.safeParse(obj);
        return result.success ? [] : result.error.issues.map(i => i.path.join('.'));
    }
}

export default {
    number: new ZodTester(z.number().finite()),
    simple: new ZodTester(createSimpleSchema()),
    nested: new ZodTester(createNestedSchema()),
    refine: new ZodTester(createRefineSchema()),
    discriminated: new ZodTester(createDiscriminatedSchema()),
    recursive: new ZodTester(createRecursiveSchema()),
    tuple: new ZodTester(createTupleSchema()),
    bigString: new ZodTester(createBigStringSchema()),
    bigArray: new ZodTester(createBigArraySchema())
};
