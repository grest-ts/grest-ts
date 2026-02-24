import {type TSchema, Type} from "@sinclair/typebox";
import {createBigArraySchema, createBigStringSchema, createDiscriminatedSchema, createNestedSchema, createRecursiveSchema, createRefineSchema, createSimpleSchema, createTupleSchema} from "./data";
import {TestRunner} from "../../lib/TestRunner";
import {TypeCheck, TypeCompiler} from "@sinclair/typebox/compiler";
import {Value} from "@sinclair/typebox/value";

export class TypeBoxTester<T extends TSchema> extends TestRunner {
    private readonly schema: T;
    private readonly compiled: TypeCheck<T>;

    constructor(schema: T) {
        super();
        this.schema = schema;
        this.compiled = TypeCompiler.Compile(schema);
    }

    before(): void {
    }

    test_is(obj: unknown): boolean {
        return this.compiled.Check(obj);
    }

    test_parse(obj: unknown): any | undefined {
        const cleaned = Value.Clean(this.schema, obj);
        if (!this.compiled.Check(cleaned)) return undefined;
        return this.compiled.Decode(cleaned);
    }

    test_string(str: string | undefined): any | undefined {
        if (!str) return undefined;
        const cleaned = Value.Clean(this.schema, JSON.parse(str));
        if (!this.compiled.Check(cleaned)) return undefined;
        return this.compiled.Decode(cleaned);
    }

    test_stringify(obj: any): any | undefined {
        if (this.compiled.Check(obj)) {
            return JSON.stringify(Value.Clean(this.schema, obj));
        } else {
            return undefined;
        }
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