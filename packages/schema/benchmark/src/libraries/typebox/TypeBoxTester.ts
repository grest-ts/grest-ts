import {type TSchema} from "@sinclair/typebox";
import {Value} from "@sinclair/typebox/value";
import {type TypeCheck, TypeCompiler} from "@sinclair/typebox/compiler";
import {TestRunner} from "../../lib/TestRunner";

export class TypeBoxTester<T extends TSchema> extends TestRunner {
    private readonly schema: T;
    private readonly compiled: TypeCheck<T> | null;

    constructor(schema: T, useCompiled: boolean) {
        super();
        this.schema = schema;
        this.compiled = useCompiled ? TypeCompiler.Compile(schema) : null;
    }

    before(): void {
    }

    test_is(obj: unknown): boolean {
        if (this.compiled) {
            return this.compiled.Check(obj);
        }
        return Value.Check(this.schema, obj);
    }

    test_parse(obj: unknown): any | undefined {
        try {
            const cleaned = Value.Clean(this.schema, obj);
            if (this.compiled) {
                return this.compiled.Decode(cleaned);
            }
            return Value.Decode(this.schema, cleaned);
        } catch {
            return undefined;
        }
    }

    test_string(str: string | undefined): any | undefined {
        if (!str) return undefined;
        try {
            const obj = JSON.parse(str);
            const cleaned = Value.Clean(this.schema, obj);
            if (this.compiled) {
                return this.compiled.Decode(cleaned);
            }
            return Value.Decode(this.schema, cleaned);
        } catch {
            return undefined;
        }
    }

    test_stringify(obj: any): any | undefined {
        const isValid = this.compiled ? this.compiled.Check(obj) : Value.Check(this.schema, obj);
        if (isValid) {
            return JSON.stringify(Value.Clean(this.schema, obj));
        }
        return undefined;
    }

    test_errorPaths(obj: unknown): string[] {
        const errors = this.compiled
            ? this.compiled.Errors(obj)
            : Value.Errors(this.schema, obj);
        return [...errors].map(e => e.path.replace(/^\//, '').replace(/\//g, '.'));
    }
}
