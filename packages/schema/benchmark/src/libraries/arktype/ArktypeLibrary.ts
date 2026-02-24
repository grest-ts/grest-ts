// @ts-nocheck - Arktype requires strict mode which is enabled in benchmark's tsconfig but not in root
import {type} from "arktype";
import {TestRunner} from "../../lib/TestRunner";
import {createBigArraySchema, createBigStringSchema, createDiscriminatedSchema, createNestedSchema, createRecursiveSchema, createRefineSchema, createSimpleSchema, createTupleSchema} from "./data";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyArkType = ReturnType<typeof type<any>>;

// Arktype Tester class
class ArktypeTester extends TestRunner {
    private readonly schema: AnyArkType;

    constructor(schema: AnyArkType) {
        super();
        this.schema = schema;
    }

    before(): void {
        // Arktype doesn't need any setup
    }

    test_is(obj: unknown): boolean {
        const result = this.schema(obj);
        return !(result instanceof type.errors);
    }

    test_parse(obj: unknown): any | undefined {
        const result = this.schema(obj);
        return result instanceof type.errors ? undefined : result;
    }

    test_string(str: string | undefined): any | undefined {
        if (!str) return undefined;
        const obj = JSON.parse(str);
        const result = this.schema(obj);
        return result instanceof type.errors ? undefined : result;
    }

    test_stringify(obj: any): any | undefined {
        const result = this.schema(obj);
        return result instanceof type.errors ? undefined : JSON.stringify(result);
    }

    test_errorPaths(obj: unknown): string[] {
        const result = this.schema(obj);
        return result instanceof type.errors ? result.map((e: any) => e.path?.join('.') ?? '') : [];
    }
}

export default {
    number: new ArktypeTester(type("number")),
    simple: new ArktypeTester(createSimpleSchema()),
    nested: new ArktypeTester(createNestedSchema()),
    refine: new ArktypeTester(createRefineSchema()),
    discriminated: new ArktypeTester(createDiscriminatedSchema()),
    recursive: new ArktypeTester(createRecursiveSchema()),
    tuple: new ArktypeTester(createTupleSchema()),
    bigString: new ArktypeTester(createBigStringSchema()),
    bigArray: new ArktypeTester(createBigArraySchema())
}
