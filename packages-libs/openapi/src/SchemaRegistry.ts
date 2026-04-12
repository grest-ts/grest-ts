import type {ANY_ERROR_CLS, GGSchema} from "@grest-ts/schema";
import type {OpenAPIV3_1} from "openapi-types";

/**
 * Registry that extracts named schemas from the spec, replacing repeated schema
 * objects with $ref references to #/components/schemas/<Name>.
 *
 * A schema is extracted when:
 *   1. Its docs.title is set — that becomes the component name.
 *   2. It is encountered more than once (same === object identity).
 *
 * Single-use schemas with no title stay inline.
 * Single-use schemas WITH a title are extracted anyway (avoids duplication if
 * the same schema is added to the document later, and gives cleaner specs).
 *
 * The walker recurses into composite schemas (object, array, union, discriminated,
 * tuple, record) using toCompilerDef() to get GGSchema instances back, so nested
 * reusable schemas are found at any depth.
 *
 * Recursive schemas (self-referencing) are handled by registering the $ref before
 * recursing into the schema body, breaking infinite loops.
 */
export class SchemaRegistry {
    /** name → resolved SchemaObject (the component definition, always from the base schema) */
    private readonly components = new Map<string, OpenAPIV3_1.SchemaObject>();
    /** base GGSchema identity → component name */
    private readonly baseToName = new Map<GGSchema<any>, string>();
    /** schemas currently being built (cycle guard) */
    private readonly building = new Set<GGSchema<any>>();

    /**
     * Return a SchemaObject or ReferenceObject for the given GGSchema.
     *
     * Uses schema._base (set by GGSchema for presentational derives) to find
     * the canonical type. The component is defined by and keyed to the base
     * schema, so decorated variants (.orUndefined, .docs(), etc.) correctly
     * resolve to the same component as their undecorated base.
     *
     * Nullable: wrapped as {oneOf: [$ref, {type:"null"}]}.
     * Field-level description differing from the base: emitted as a sibling
     * alongside the $ref (valid in OpenAPI 3.1).
     */
    schemaOrRef(schema: GGSchema<any>): OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject {
        const base: GGSchema<any> = schema._base ?? schema;
        const title = base.def.docs?.title;

        if (title) {
            const name = toComponentName(title);

            if (!this.baseToName.has(base)) {
                this.baseToName.set(base, name);
                if (!this.building.has(base)) {
                    this.building.add(base);
                    const resolved = this.buildSchemaObject(base);
                    this.components.set(name, resolved);
                    this.building.delete(base);
                }
            }

            const ref: OpenAPIV3_1.ReferenceObject = {$ref: `#/components/schemas/${name}`};

            // Nullable — wrap in oneOf [$ref, null]
            if (schema.def.nullable) {
                return {oneOf: [ref, {type: 'null'}]};
            }

            // Field-level description sibling (OpenAPI 3.1 allows keywords alongside $ref)
            const fieldDesc = schema.def.docs?.description;
            const baseDesc = base.def.docs?.description;
            if (fieldDesc && fieldDesc !== baseDesc) {
                return {...ref, description: fieldDesc} as OpenAPIV3_1.SchemaObject;
            }

            return ref;
        }

        // No title on base — inline, recurse into composites to find named children
        return this.buildSchemaObject(schema);
    }

    /**
     * Build the resolved SchemaObject for a schema, recursing into composites.
     * Uses toJSONSchema() as the base and replaces nested schema references
     * with $ref where applicable.
     */
    private buildSchemaObject(schema: GGSchema<any>): OpenAPIV3_1.SchemaObject {
        const def = schema.toCompilerDef() as any;

        switch (def.type) {
            case 'object': {
                if (!def.shape) return schema.toJSONSchema();
                const properties: Record<string, OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject> = {};
                const required: string[] = [];
                for (const [key, child] of Object.entries(def.shape as Record<string, GGSchema<any>>)) {
                    properties[key] = this.schemaOrRef(child);
                    if (!child.def.optional) required.push(key);
                }
                const base: OpenAPIV3_1.NonArraySchemaObject = {type: 'object', properties};
                if (required.length) base.required = required;
                return this.applyDocsAndNullable(base, schema);
            }

            case 'array': {
                if (!def.element) return schema.toJSONSchema();
                const items = this.schemaOrRef(def.element as GGSchema<any>);
                const base: OpenAPIV3_1.ArraySchemaObject = {type: 'array', items};
                if (def.minLength !== undefined) base.minItems = def.minLength;
                if (def.maxLength !== undefined) base.maxItems = def.maxLength;
                return this.applyDocsAndNullable(base, schema);
            }

            case 'union': {
                const variants: (OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject)[] =
                    (def.variants as GGSchema<any>[]).map(v => this.schemaOrRef(v));
                const base: OpenAPIV3_1.SchemaObject = {oneOf: variants};
                return this.applyDocsAndNullable(base, schema);
            }

            case 'discriminated': {
                const variantMap = def.variantMap as ReadonlyMap<string | number | boolean, GGSchema<any>>;
                const variants = Array.from(variantMap.values()).map(v => this.schemaOrRef(v));
                const base: OpenAPIV3_1.SchemaObject = {
                    oneOf: variants,
                    discriminator: {propertyName: def.discriminator}
                };
                return this.applyDocsAndNullable(base, schema);
            }

            case 'tuple': {
                const elements = def.elements as GGSchema<any>[];
                const prefixItems = elements.map(e => this.schemaOrRef(e));
                const base = {
                    type: 'array',
                    prefixItems,
                    minItems: elements.length,
                    maxItems: elements.length,
                    items: false,
                } as unknown as OpenAPIV3_1.ArraySchemaObject;
                return this.applyDocsAndNullable(base, schema);
            }

            case 'record': {
                const additionalProperties = this.schemaOrRef(def.value as GGSchema<any>);
                const base: OpenAPIV3_1.NonArraySchemaObject = {type: 'object', additionalProperties};
                return this.applyDocsAndNullable(base, schema);
            }

            default:
                // Leaf type (string, number, boolean, literal, bit, any, unknown, file, password…)
                // toJSONSchema() already handles all docs/format/default/nullable.
                return schema.toJSONSchema();
        }
    }

    /**
     * Apply docs, format, and default onto an already-built composite schema.
     * Called only for base schemas (no presentational modifiers) — nullable is
     * handled upstream in schemaOrRef(), not here.
     */
    private applyDocsAndNullable(
        built: OpenAPIV3_1.SchemaObject,
        schema: GGSchema<any>
    ): OpenAPIV3_1.SchemaObject {
        const {docs, defaultValue} = schema.def;
        if (!docs && defaultValue === undefined) return built;
        return {
            ...built,
            ...(docs?.title !== undefined ? {title: docs.title} : {}),
            ...(docs?.description !== undefined ? {description: docs.description} : {}),
            ...(docs?.format !== undefined ? {format: docs.format} : {}),
            ...(docs?.example !== undefined ? {example: docs.example} : {}),
            ...(docs?.examples !== undefined ? {examples: [...docs.examples]} : {}),
            ...(docs?.deprecated === true ? {deprecated: true} : {}),
            ...(defaultValue !== undefined ? {default: defaultValue} : {}),
        };
    }

    /** Cache of error class identity → component name for full error body schemas. */
    private readonly errClsToName = new Map<ANY_ERROR_CLS, string>();

    /**
     * Return a $ref to the full error body schema for the given error class, registering
     * it in components/schemas on first encounter.
     *
     * The wire shape is always: { success: false, type: "<TYPE>", data?: <data schema> }
     * Component name is derived from the TYPE string:
     *   "VALIDATION_ERROR" → "Error_ValidationError"
     *   "SERVER_ERROR"     → "Error_ServerError"
     *   "NOT_FOUND"        → "Error_NotFound"
     */
    errorBodyRef(errCls: ANY_ERROR_CLS): OpenAPIV3_1.ReferenceObject {
        if (!this.errClsToName.has(errCls)) {
            const name = errorComponentName(errCls.TYPE);
            this.errClsToName.set(errCls, name);

            const dataSchemaOrRef: OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject | undefined =
                errCls.schema != null ? this.schemaOrRef(errCls.schema as GGSchema<any>) : undefined;

            const props: NonNullable<OpenAPIV3_1.BaseSchemaObject["properties"]> = {
                success: {type: "boolean", enum: [false]},
                type: {type: "string", enum: [errCls.TYPE]},
            };
            if (dataSchemaOrRef !== undefined) props.data = dataSchemaOrRef;

            const body: OpenAPIV3_1.NonArraySchemaObject = {
                type: "object",
                properties: props,
                required: ["success", "type", ...(dataSchemaOrRef !== undefined ? ["data"] : [])],
            };
            this.components.set(name, body);
        }
        return {$ref: `#/components/schemas/${this.errClsToName.get(errCls)!}`};
    }

    /** Returns the collected components/schemas map (empty if no named schemas found). */
    getComponents(): Record<string, OpenAPIV3_1.SchemaObject> | undefined {
        if (this.components.size === 0) return undefined;
        return Object.fromEntries(this.components);
    }
}

/**
 * Convert a human-readable title to a valid OpenAPI component name.
 * e.g. "User profile" → "UserProfile", "Order placed event" → "OrderPlacedEvent"
 */
export function toComponentName(title: string): string {
    return title
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join('');
}

/**
 * Convert an ERROR TYPE string to an OpenAPI component name.
 * e.g. "VALIDATION_ERROR" → "Error_ValidationError"
 *      "NOT_FOUND"        → "Error_NotFound"
 *      "SERVER_ERROR"     → "Error_ServerError"
 *
 * The "Error_" prefix makes these immediately recognisable in the components list
 * and avoids collisions with schema component names.
 */
export function errorComponentName(type: string): string {
    const pascal = type
        .split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('');
    return `Error_${pascal}`;
}
