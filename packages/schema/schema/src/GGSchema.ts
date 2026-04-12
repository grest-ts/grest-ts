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
     * Set automatically by presentational derive calls: .docs(), .default(), .orUndefined,
     * .orNull, .refine(), .coerce(). Structural calls (.minLength(), .regex(), .extend(), etc.)
     * do NOT set this, making the new schema its own base.
     *
     * Useful for tools like @grest-ts/openapi that need the canonical type identity
     * independently of presentational decorations applied at the usage site.
     *
     * @example
     * IsEmail._base                                    // undefined — IsEmail is its own base
     * IsEmail.orUndefined._base                        // IsEmail
     * IsEmail.orUndefined.docs({description: "..."})._base  // IsEmail
     * IsEmail.regex(/extra/)._base                     // undefined — new structural type
     * IsEmail.regex(/extra/).docs({...})._base         // IsEmail.regex(/extra/)
     */
    public _base: GGSchema<any> | undefined = undefined;

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

    public brand<B extends string>(_name: B): GGSchema<Type & Brand<B>, TDef> {
        return this as any;
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
            result._base = this._base ?? this;
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

    /**
     * Returns a JSON Schema / OpenAPI 3.1 representation of this schema.
     * Convenience wrapper over toSchemaDescription() for direct use.
     * @see toSchemaDescription() for the format-agnostic alternative.
     */
    public toJSONSchema(): Record<string, unknown> {
        return schemaDescriptionToJsonSchema(this.toSchemaDescription());
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

/**
 * Convert a GGSchemaDescription to a plain JSON Schema object.
 * This is the schema library's own JSON Schema converter — used by toJSONSchema()
 * so that the convenience method continues to work without any external dependencies.
 * Returns Record<string, unknown> — callers that need typed output (e.g. @grest-ts/openapi)
 * cast to their format-specific type.
 */
function schemaDescriptionToJsonSchema(desc: GGSchemaDescription): Record<string, unknown> {
    const node = desc.node;
    let schema: Record<string, unknown>;

    switch (node.kind) {
        case 'string': {
            schema = {type: 'string'};
            if (node.minLength !== undefined) schema.minLength = node.minLength;
            if (node.maxLength !== undefined) schema.maxLength = node.maxLength;
            if (node.pattern) schema.pattern = node.pattern;
            break;
        }
        case 'number': {
            schema = {type: node.integer ? 'integer' : 'number'};
            if (node.min !== undefined) schema.minimum = node.min;
            if (node.max !== undefined) schema.maximum = node.max;
            if (node.multipleOf !== undefined) schema.multipleOf = node.multipleOf;
            break;
        }
        case 'boolean': schema = {type: 'boolean'}; break;
        case 'bit':     schema = {type: 'integer', minimum: 0, maximum: 1}; break;
        case 'any':
        case 'unknown': schema = {}; break;
        case 'literal': {
            const types = new Set(node.values.map(v => {
                if (typeof v === 'boolean') return 'boolean';
                if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
                return 'string';
            }));
            schema = {enum: [...node.values]};
            if (types.size === 1) schema.type = types.values().next().value;
            break;
        }
        case 'array': {
            schema = {type: 'array', items: schemaDescriptionToJsonSchema(node.element)};
            if (node.minItems !== undefined) schema.minItems = node.minItems;
            if (node.maxItems !== undefined) schema.maxItems = node.maxItems;
            break;
        }
        case 'object': {
            const properties: Record<string, unknown> = {};
            for (const [k, child] of Object.entries(node.properties)) {
                properties[k] = schemaDescriptionToJsonSchema(child);
            }
            schema = {type: 'object', properties};
            if (node.required.length) schema.required = node.required;
            break;
        }
        case 'record':
            schema = {type: 'object', additionalProperties: schemaDescriptionToJsonSchema(node.value)};
            break;
        case 'union':
            schema = {oneOf: node.variants.map(schemaDescriptionToJsonSchema)};
            break;
        case 'discriminated':
            schema = {
                oneOf: node.variants.map(schemaDescriptionToJsonSchema),
                discriminator: {propertyName: node.discriminator}
            };
            break;
        case 'tuple':
            schema = {
                type: 'array',
                prefixItems: node.elements.map(schemaDescriptionToJsonSchema),
                minItems: node.elements.length,
                maxItems: node.elements.length,
                items: false,
            };
            break;
        case 'file': {
            schema = {type: 'string', format: 'binary'};
            if (node.accept?.length) schema.description = `Accepted types: ${node.accept.join(', ')}`;
            break;
        }
        case 'password':
            schema = {type: 'string', format: 'password', minLength: node.minLength, maxLength: node.maxLength};
            break;
        default:
            schema = {};
    }

    const {docs, defaultValue} = desc;
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

    if (desc.nullable) {
        schema = {oneOf: [schema, {type: 'null'}]};
    }

    return schema;
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
