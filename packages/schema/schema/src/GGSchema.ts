import {GGIssuesList} from "./issue/GGIssuesList";
import {GGIssueKey} from "./issue/GGIssueKey";
import {GGSchemaDefinition, GGSchemaDocs, GGSchemaBinaryData, GGJsonStringifyResult, GGSchemaNonJsonDefinition, isNonJsonDef} from "./Definition";
import type {ArrayDef, ObjectDef} from "./Definition";
import type {ExecutorStrategy, StringifyFn} from "./executor/ExecutorStrategy";
import {AOTExecutor} from "./executor/aot/AOTExecutor";
import {GGCodec} from "./GGCodec";
import {GGTransform} from "./GGTransform";
import {Raw} from "./issue/types";
import type {OpenAPIV3_1} from "openapi-types";

export type GGParseResult<T> =
    | { success: true; value: T }
    | { success: false; issues: GGIssuesList };

export interface GGValidator<Type> {

    is(value: unknown): value is Type;

    assert: (value: unknown) => asserts value is Type;

    parse: (value: unknown, coerce?: boolean) => Type;

    safeParse: (value: unknown, coerce?: boolean) => GGParseResult<Type>;

}

export type Brand<T extends string> = { readonly __brand: T };

/** Structural marker for optional schemas. Applied by orUndefined. Call .orUndefined last in chain. */
export type Opt = { readonly __opt: true };

export abstract class GGSchema<Type, TDef extends GGSchemaDefinition = GGSchemaDefinition> {

    public readonly def: TDef;
    private _compilerDef?: TDef;

    private _orUndefined?: GGSchema<Type | undefined, TDef>;
    private _orNull?: GGSchema<Type | null, TDef>;

    /**
     * The executor strategy to use for schema operations.
     * Set to AotExecutor for AOT compilation (default), or InterpreterExecutor for interpreter mode.
     */
    public static EXECUTOR: ExecutorStrategy = AOTExecutor.instance;

    /**
     * When true, use fast number checking (typeof v === 'number') instead of Number.isFinite(v).
     * This is faster (~2.5x) but accepts NaN and Infinity as valid numbers.
     * Default: false (strict mode - rejects NaN/Infinity for safety)
     */
    public static FAST_NUMBER_CHECK = false;

    public constructor(def: TDef) {
        this.def = Object.freeze({...def});
    }

    // ---------------------------------------------------------------------------------------------------------

    public default(value: Exclude<Type, undefined>): GGSchema<Exclude<Type, undefined>, TDef> {
        return this.derive({defaultValue: value} as Partial<TDef>) as GGSchema<Exclude<Type, undefined>, TDef>;
    }

    public get orUndefined(): GGSchema<Type | undefined, TDef> & Opt {
        if (this.def.optional) return this as any;
        if (!this._orUndefined) {
            this._orUndefined = this.derive<Type | undefined>({optional: true} as Partial<TDef>)
        }
        return this._orUndefined as GGSchema<Type | undefined, TDef> & Opt;
    }

    public get orNull(): GGSchema<Type | null, TDef> {
        if (this.def.nullable) return this as any;
        if (!this._orNull) {
            this._orNull = this.derive<Type | null>({nullable: true} as Partial<TDef>)
        }
        return this._orNull;
    }

    public get infer(): Type {
        throw new Error("infer is a type-only property");
    }

    public docs(docs: GGSchemaDocs): this {
        return this.derive({docs: this.def.docs ? {...this.def.docs, ...docs} : docs} as Partial<TDef>) as this;
    }

    public refine(check: (value: Type) => boolean, error: GGIssueKey): GGSchema<Type, TDef> {
        return this.derive({refinements: [...(this.def.refinements ?? []), {check, error}]} as any);
    }

    public coerce(fn: (value: Type) => Type): this {
        return this.derive({coercions: [...(this.def.coercions ?? []), fn]} as any) as this;
    }

    public brand<B extends string>(_name: B): GGSchema<Type & Brand<B>, TDef> {
        return this as any;
    }

    protected abstract derive<NewT extends Type | undefined | null = Type>(changes: Partial<TDef>): GGSchema<NewT, TDef>;

    // ----------------------------------

    /**
     * Checks if value matches expected structure
     * Does not check for extra properties!
     * If not valid returns true. If not, false.
     * @final (overwriting this breaks AOT!)
     */
    public is(value: unknown): value is Type {
        this.is = GGSchema.EXECUTOR.createIs(this) as (value: unknown) => value is Type;
        return this.is(value);
    }

    /**
     * Asserts if value matches expected structure
     * Does not check for extra properties!
     * If not valid, throws.
     */
    public assert(value: unknown): asserts value is Type {
        const issues = new GGIssuesList()
        this._parse(value, issues, "");
        if (issues.length > 0) {
            throw issues
        }
    }

    // ----------------------------------

    /**
     * Returns object with success property for discriminated check.
     * If true, the value is cleaned and correct.
     * If false, the issues list contains all validation errors.
     */
    public safeParse(value: unknown, coerce?: boolean): GGParseResult<Type> {
        const issues = new GGIssuesList();
        const result = this._parse(value, issues, "", coerce);
        if (issues.length > 0) {
            return {success: false, issues}
        } else {
            return {success: true, value: result!}
        }
    }

    /**
     * Returns cleaned and checked value or throws GGIssuesList
     */
    public parse(value: unknown, coerce?: boolean): Type {
        const issues = new GGIssuesList();
        const result = this._parse(value, issues, "", coerce);
        if (issues.length > 0) {
            throw issues
        } else {
            return result!
        }
    }

    /**
     * @final (overwriting this breaks AOT!)
     */
    public _parse(value: unknown, issues: GGIssuesList, path: string, coerce?: boolean): Type | undefined {
        this._parse = GGSchema.EXECUTOR.createParse(this);
        return this._parse(value, issues, path, coerce);
    }

    // ----------------------------------

    public clean(value: unknown, transform: boolean = false): unknown {
        this.clean = GGSchema.EXECUTOR.createClean(this);
        return this.clean(value, transform);
    }

    // ----------------------------------

    private _stringifyFn?: StringifyFn;

    /**
     * Validates and stringifies value to JSON string.
     * Returns undefined if validation fails.
     * Throws if schema contains non-JSON data (files, binary) - use stringifyMultipart() instead.
     *
     * @final (overwriting this breaks AOT!)
     */
    public stringify(value: unknown): string | undefined {
        if (!this.is(value)) return undefined;
        return this.unsafeStringify(value);
    }

    /**
     * Stringify value to JSON string. Uses compiled inline code when available.
     * Assumes a validated value. Unvalidated values can give unexpected results!
     * Throws if schema contains non-JSON data (files, binary) - use unsafeStringifyMultipart() instead.
     *
     * Like JSON.stringify, this will throw on circular references.
     * @final (overwriting this breaks AOT!)
     */
    public unsafeStringify(value: Type): string | undefined {
        if (!this._stringifyFn) {
            this._stringifyFn = GGSchema.EXECUTOR.createStringify(this);
        }
        if (this.def.hasNonJsonData) {
            throw new Error('Schema contains non-JSON data. Use stringifyMultipart() instead.');
        }
        const extras: Promise<GGSchemaBinaryData>[] = [];
        return this._stringifyFn(value, extras)!;
    }

    /**
     * Validates and stringifies value, collecting non-JSON data (files, binary) in extras.
     * Returns undefined if validation fails.
     *
     * @returns StringifyResult with json string and extras array.
     *          If extras is empty, data is pure JSON.
     *          If extras has items, use them to build multipart body.
     * @final (overwriting this breaks AOT!)
     */
    public async stringifyMultipart(value: unknown): Promise<GGJsonStringifyResult | undefined> {
        if (!this.is(value)) return undefined;
        return this.unsafeStringifyMultipart(value);
    }

    /**
     * Stringify value to JSON, collecting non-JSON data (files, binary) in extras.
     * Assumes a validated value. Unvalidated values can give unexpected results!
     *
     * @returns StringifyResult with json string and extras array.
     *          If extras is empty, data is pure JSON.
     *          If extras has items, use them to build multipart body.
     *
     * Like JSON.stringify, this will throw on circular references.
     * @final (overwriting this breaks AOT!)
     */
    public async unsafeStringifyMultipart(value: Type): Promise<GGJsonStringifyResult> {
        if (!this._stringifyFn) {
            this._stringifyFn = GGSchema.EXECUTOR.createStringify(this);
        }
        const extraPromises: Promise<GGSchemaBinaryData>[] = [];
        const json = this._stringifyFn(value, extraPromises);
        const extras = await Promise.all(extraPromises);
        return {json: json!, extras};
    }

    // ---------------------------------------------------------------------------------------------------------

    public codecTo<NewType>(to: GGSchema<NewType>, codec: GGSchemaCodec<Type, NewType>): GGCodec<Type, NewType> {
        return new GGCodec<Type, NewType>({
            encode: this.transformTo(to, codec.encode),
            decode: to.transformTo(this, codec.decode)
        })
    }

    public transformTo<NewType>(to: GGSchema<NewType>, transform: (input: Type) => Raw<NewType>): GGTransform<Type, NewType> {
        return new GGTransform<Type, NewType>(this, to, transform)
    }

    // ---------------------------------------------------------------------------------------------------------

    /**
     * Collects non-JSON decoders from this schema tree.
     * Returns a map of path -> decoder function for all non-JSON leaf nodes.
     * Paths use dot-separated keys, with "*" for array elements.
     * e.g. "avatar" -> decoder, "files.*" -> decoder, "meta.docs.*" -> decoder
     */
    public collectNonJsonDecoders(): Map<string, (raw: GGSchemaBinaryData) => Promise<unknown>> {
        const map = new Map<string, (raw: GGSchemaBinaryData) => Promise<unknown>>();
        collectDecoders(this, "", map);
        return map;
    }

    // ---------------------------------------------------------------------------------------------------------

    /**
     * Returns a JSON Schema / OpenAPI 3.1 representation of this schema.
     *
     * Subclasses implement _buildJsonSchema() with their type-specific output.
     * This method wraps it with nullable (oneOf null), docs annotations, and defaultValue.
     */
    public toJSONSchema(): OpenAPIV3_1.SchemaObject {
        let schema = this._buildJsonSchema();

        // Apply docs annotations and default onto the base schema first, so they
        // end up inside oneOf[0] (the actual type variant) rather than on the
        // nullable wrapper — keeping annotations semantically tied to the type.
        const {docs, defaultValue} = this.def;
        if (docs || defaultValue !== undefined) {
            schema = {
                ...schema,
                ...(docs?.title !== undefined ? {title: docs.title} : {}),
                ...(docs?.description !== undefined ? {description: docs.description} : {}),
                ...(docs?.format !== undefined ? {format: docs.format} : {}),
                ...(docs?.example !== undefined ? {example: docs.example} : {}),
                ...(docs?.examples !== undefined ? {examples: [...docs.examples]} : {}),
                ...(docs?.deprecated === true ? {deprecated: true} : {}),
                ...(defaultValue !== undefined ? {default: defaultValue} : {}),
            };
        }

        if (this.def.nullable) {
            schema = {oneOf: [schema, {type: "null"}]};
        }

        return schema;
    }

    /**
     * Override in subclasses to return the type-specific JSON Schema object.
     * Do NOT apply nullable, docs, or defaultValue here — toJSONSchema() does that.
     */
    protected _buildJsonSchema(): OpenAPIV3_1.SchemaObject {
        return {};
    }

    private static _compiling = new Set<GGSchema<any>>();

    /**
     * Returns the schema definition with any resolved values needed for compilation.
     * Cached after first call. Override _toCompilerDef() in subclasses for lazy-resolved properties.
     */
    public toCompilerDef(): TDef {
        if (this._compilerDef) return this._compilerDef;
        if (GGSchema._compiling.has(this)) {
            return this.def;
        }
        GGSchema._compiling.add(this);
        try {
            return this._compilerDef ??= this._toCompilerDef();
        } finally {
            GGSchema._compiling.delete(this);
        }
    }

    /**
     * Override in subclasses that have lazy-resolved properties (e.g., ObjectSchema with shapeFactory).
     * Called once by toCompilerDef(), result is cached.
     */
    protected _toCompilerDef(): TDef {
        return this.def;
    }
}

type NonJsonDecoder = (raw: GGSchemaBinaryData) => Promise<unknown>;

function collectDecoders(schema: GGSchema<any>, path: string, map: Map<string, NonJsonDecoder>): void {
    const def = schema.toCompilerDef();

    if (isNonJsonDef(def)) {
        map.set(path, (def as GGSchemaNonJsonDefinition).decodeFromRaw.bind(def));
        return;
    }

    if (!def.hasNonJsonData) return;

    if (def.type === 'object' && (def as ObjectDef).shape) {
        const shape = (def as ObjectDef).shape!;
        for (const key of Object.keys(shape)) {
            const child = shape[key];
            if (child instanceof GGSchema) {
                collectDecoders(child, path ? path + "." + key : key, map);
            }
        }
    } else if (def.type === 'array' && (def as ArrayDef).element) {
        collectDecoders((def as ArrayDef).element!, path ? path + ".*" : "*", map);
    }
}

export interface GGSchemaCodec<Input, Output> {
    encode: (value: Input) => Raw<Output>;
    decode: (value: Output) => Raw<Input>;
}
