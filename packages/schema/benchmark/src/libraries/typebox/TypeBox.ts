import {type TSchema, Type} from "@sinclair/typebox";
import {createBigArraySchema, createBigStringSchema, createDiscriminatedSchema, createNestedSchema, createRecursiveSchema, createRefineSchema, createSimpleSchema, createTupleSchema} from "./data";
import {TestRunner} from "../../lib/TestRunner";
import {Value} from "@sinclair/typebox/value";

export class TypeBoxTester<T extends TSchema> extends TestRunner {
    private readonly schema: T;

    constructor(schema: T) {
        super();
        this.schema = schema;
    }

    before(): void {
    }

    test_is(obj: unknown): boolean {
        return Value.Check(this.schema, obj);
    }

    test_parse(obj: unknown): any | undefined {
        const cleaned = Value.Clean(this.schema, obj);
        if (!Value.Check(this.schema, cleaned)) return undefined;
        return Value.Decode(this.schema, cleaned);
    }

    test_string(str: string): any | undefined {
        const cleaned = Value.Clean(this.schema, JSON.parse(str));
        if (!Value.Check(this.schema, cleaned)) return undefined;
        return Value.Decode(this.schema, cleaned);
    }

    test_stringify(obj: any): any | undefined {
        return Value.Check(this.schema, obj) ? JSON.stringify(Value.Clean(this.schema, obj)) : undefined;
    }

    test_errorPaths(obj: unknown): string[] {
        const errors = [...Value.Errors(this.schema, obj)];
        return errors.map(e => e.path.replace(/^\//, '').replace(/\//g, '.'));
    }
}

export default {
    number: new TypeBoxTester(Type.Number()),
    simple: new TypeBoxTester(createSimpleSchema()),
    nested: new TypeBoxTester(createNestedSchema()),
    refine: new TypeBoxTester(createRefineSchema()),
    discriminated: new TypeBoxTester(createDiscriminatedSchema()),
    recursive: new TypeBoxTester(createRecursiveSchema()),
    tuple: new TypeBoxTester(createTupleSchema()),
    bigString: new TypeBoxTester(createBigStringSchema()),
    bigArray: new TypeBoxTester(createBigArraySchema())
};