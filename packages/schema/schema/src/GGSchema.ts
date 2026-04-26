import {GGIssuesList} from "./issue/GGIssuesList";
import {GGIssueKey} from "./issue/GGIssueKey";
import {GGSchemaDefinition, GGSchemaDocs, GGSchemaBinaryData, GGJsonStringifyResult, GGSchemaNonJsonDefinition, isNonJsonDef} from "./Definition";
import type {ArrayDef, ObjectDef} from "./Definition";
import type {ExecutorStrategy, StringifyFn} from "./executor/ExecutorStrategy";
import {AOTExecutor} from "./executor/aot/AOTExecutor";
import {GGCodec} from "./GGCodec";
import {GGTransform} from "./GGTransform";
import {Raw} from "./issue/types";
import type {GGSchemaDescription, GGSchemaNodeKind} from "./GGSchemaDescription";

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
     * Points to the nearest ancestor schema that introduced a structural (non-presentational) change.
     * Set once by derive() for presentational variants; never mutated after construction.
     * Consumed via GGSchemaDescription.canonical — do not access directly from outside the class.
     *
     * @example
     * IsEmail._base                                    // undefined — IsEmail is its own base
     * IsEmail.orUndefined._base                        // IsEmail
     * IsEmail.orUndefined.docs({description: "..."})._base  // IsEmail
     * IsEmail.regex(/extra/)._base                     // undefined — new structural type
     * IsEmail.regex(/extra/).docs({...})._base         // IsEmail.regex(/extra/)
     */
    readonly _base: GGSchema<any> | undefined = undefined;

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
        return this.derive({defaultValue: value} as Partial<TDef>, true) as GGSchema<Exclude<Type, undefined>, TDef>;
    }

    public get orUndefined(): GGSchema<Type | undefined, TDef> & Opt {
        if (this.def.optional) return this as any;
        if (!this._orUndefined) {
            this._orUndefined = this.derive<Type | undefined>({optional: true} as Partial<TDef>, true)
        }
        return this._orUndefined as GGSchema<Type | undefined, TDef> & Opt;
    }

    public get orNull(): GGSchema<Type | null, TDef> {
        if (this.def.nullable) return this as any;
        if (!this._orNull) {
            this._orNull = this.derive<Type | null>({nullable: true} as Partial<TDef>, true)
        }
        return this._orNull;
    }

    public get infer(): Type {
        throw new Error("infer is a type-only property");
    }

    public docs(docs: GGSchemaDocs): this {
        const mergedDocs = this.def.docs ? {...this.def.docs, ...docs} : docs;
        // Adding or changing a title is a structural change — it names this schema as a new type.
        // All other doc fields (description, example, deprecated, format) are presentational.
        const titleChanged = docs.title !== undefined && docs.title !== this.def.docs?.title;
        return this.derive({docs: mergedDocs} as Partial<TDef>, !titleChanged) as this;
    }

    public refine(check: (value: Type) => boolean, error: GGIssueKey): GGSchema<Type, TDef> {
        return this.derive({refinements: [...(this.def.refinements ?? []), {check, error}]} as any, true);
    }

    public coerce(fn: (value: Type) => Type): this {
        return this.derive({coercions: [...(this.def.coercions ?? []), fn]} as any, true) as this;
    }

    public brand<B extends string>(name: B): GGSchema<Type & Brand<B>, TDef> {
        // The TypeScript-side `Brand<B>` intersection is purely type-level.
        // We also stash the name into `docs.brand` at runtime so docs and
        // openapi/asyncapi tooling can surface the brand alongside the
        // underlying primitive (e.g. `string & UserId`). Explicit
        // `.docs({brand: "..."})` always wins.
        if (this.def.docs?.brand !== undefined) {
            return this as any;
        }
        const mergedDocs: GGSchemaDocs = {...(this.def.docs ?? {}), brand: name};
        return this.derive({docs: mergedDocs} as Partial<TDef>, true) as any;
    }

    /**
     * Create a derived schema with the given changes.
     *
     * @param changes - Fields to override in the schema definition.
     * @param presentational - When true, the derived schema is a presentational variant
     *   (docs, optional, nullable, default, refine, coerce) — its _base pointer is set
     *   to this schema's _base (or this schema itself), so the canonical type identity
     *   is preserved across decoration chains.
     *   Structural changes (constraints, shape, pattern, etc.) leave presentational=false
     *   (the default), making the new schema its own base.
     */
    protected derive<NewT extends Type | undefined | null = Type>(
        changes: Partial<TDef>,
        presentational = false
    ): GGSchema<NewT, TDef> {
        const result = this._buildDerived<NewT>(changes);
        if (presentational) {
            // _base is readonly — set once here via Object.assign (the only write point).
            Object.assign(result, {_base: this._base ?? this});
        }
        return result;
    }

    /** Subclasses implement this to construct the new schema instance. */
    protected abstract _buildDerived<NewT extends Type | undefined | null = Type>(changes: Partial<TDef>): GGSchema<NewT, TDef>;

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
     * Returns a complete, format-agnostic description of this schema.
     *
     * Subclasses implement _buildSchemaNode() with their structural content.
     * This method wraps it with the full usage-site metadata:
     *   - canonical: the base schema (set by presentational derives)
     *   - docs, defaultValue, nullable, optional
     *
     * Consumers (OpenAPI, Protobuf, JSON Schema, etc.) use this to build
     * their own output format without coupling to schema internals.
     */
    public toSchemaDescription(): GGSchemaDescription {
        return {
            schema: this,
            canonical: this._base,
            node: this._buildSchemaNode(),
            docs: this.def.docs,
            defaultValue: this.def.defaultValue,
            nullable: this.def.nullable ?? false,
            optional: this.def.optional ?? false,
        };
    }

    /**
     * Override in subclasses to return the structural content of this schema.
     * Do NOT include nullable, docs, or defaultValue here — toSchemaDescription() does that.
     */
    protected _buildSchemaNode(): GGSchemaNodeKind {
        return {kind: 'any'};
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
