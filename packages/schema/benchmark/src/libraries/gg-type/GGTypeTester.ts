// Shared tester class for @grest-ts/schema library
import {AOTExecutor, GGSchema, StandardExecutor} from "@grest-ts/schema";
import {GGBenchTestCases, TestRunner} from "../../lib/TestRunner";
import {
    createBigArraySchema,
    createBigStringSchema,
    createDiscriminatedSchema,
    createNestedSchema,
    createNumberSchema,
    createRecursiveSchema,
    createRefineSchema,
    createSimpleSchema,
    createTupleSchema
} from "./data";

export class GGTypeTester extends TestRunner {
    private readonly schema: GGSchema<any, any>;
    private readonly useCompiled: boolean;

    constructor(schema: GGSchema<any, any>, useCompiled: boolean) {
        super();
        this.schema = schema;
        this.useCompiled = useCompiled;
    }

    public before() {
        GGSchema.EXECUTOR = this.useCompiled ? new AOTExecutor() : new StandardExecutor();
        GGSchema.FAST_NUMBER_CHECK = true;
    }

    public test_is(obj: unknown): boolean {
        return this.schema.is(obj);
    }

    public test_parse(obj: unknown): any | undefined {
        const result = this.schema.safeParse(obj);
        return result.success ? result.value : undefined;
    }

    public test_string(str: string | undefined): any | undefined {
        if (!str) return undefined;
        const obj = JSON.parse(str);
        const result = this.schema.safeParse(obj);
        return result.success ? result.value : undefined;
    }

    public test_stringify(obj: any): string | undefined {
        return this.schema.stringify(obj);
    }

    public test_errorPaths(obj: unknown): string[] {
        const result = this.schema.safeParse(obj);
        if (result.success) return [];
        // Type assertion needed because TS doesn't narrow after early return in some contexts
        const issues = (result as { success: false; issues: { length: number; getPath(i: number): string | undefined } }).issues;
        const paths: string[] = [];
        for (let i = 0; i < issues.length; i++) {
            paths.push(issues.getPath(i)!);
        }
        return paths;
    }
}

export function createGGTypeLibrary(useCompiled: boolean): GGBenchTestCases {
    return {
        number: new GGTypeTester(createNumberSchema(), useCompiled),
        simple: new GGTypeTester(createSimpleSchema(), useCompiled),
        nested: new GGTypeTester(createNestedSchema(), useCompiled),
        refine: new GGTypeTester(createRefineSchema(), useCompiled),
        discriminated: new GGTypeTester(createDiscriminatedSchema(), useCompiled),
        recursive: new GGTypeTester(createRecursiveSchema(), useCompiled),
        tuple: new GGTypeTester(createTupleSchema(), useCompiled),
        bigString: new GGTypeTester(createBigStringSchema(), useCompiled),
        bigArray: new GGTypeTester(createBigArraySchema(), useCompiled),
    };
}
