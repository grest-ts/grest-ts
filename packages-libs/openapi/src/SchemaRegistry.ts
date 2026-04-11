import type {GGSchema} from "@grest-ts/schema";
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
    /** name → resolved SchemaObject (the component definition) */
    private readonly components = new Map<string, OpenAPIV3_1.SchemaObject>();
    /** GGSchema identity → component name */
    private readonly schemaToName = new Map<GGSchema<any>, string>();
    /** GGSchema identity → seen count (to detect reuse) */
    private readonly seen = new Map<GGSchema<any>, number>();
    /** schemas currently being built (cycle guard) */
    private readonly building = new Set<GGSchema<any>>();

    /**
     * Return a SchemaObject or ReferenceObject for the given GGSchema.
     * Recursively walks composite types to extract their named sub-schemas.
     */
    schemaOrRef(schema: GGSchema<any>): OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject {
        const title = schema.def.docs?.title;
        const count = (this.seen.get(schema) ?? 0) + 1;
        this.seen.set(schema, count);

        // Extract to components if it has a title (regardless of reuse count)
        if (title) {
            const name = toComponentName(title);
            if (!this.schemaToName.has(schema)) {
                this.schemaToName.set(schema, name);
                // Register before recursing to break cycles
                if (!this.building.has(schema)) {
                    this.building.add(schema);
                    const resolved = this.buildSchemaObject(schema);
                    this.components.set(name, resolved);
                    this.building.delete(schema);
                }
            }
            return {$ref: `#/components/schemas/${name}`};
        }

        // No title — inline, but still recurse into composites to find named children
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
     * Apply docs, format, default, and nullable wrapping onto an already-built base schema.
     * Mirrors the logic in GGSchema.toJSONSchema() for composite types we built ourselves.
     */
    private applyDocsAndNullable(
        base: OpenAPIV3_1.SchemaObject,
        schema: GGSchema<any>
    ): OpenAPIV3_1.SchemaObject {
        const {docs, defaultValue} = schema.def;
        if (docs || defaultValue !== undefined) {
            base = {
                ...base,
                ...(docs?.title !== undefined ? {title: docs.title} : {}),
                ...(docs?.description !== undefined ? {description: docs.description} : {}),
                ...(docs?.format !== undefined ? {format: docs.format} : {}),
                ...(docs?.example !== undefined ? {example: docs.example} : {}),
                ...(docs?.examples !== undefined ? {examples: [...docs.examples]} : {}),
                ...(docs?.deprecated === true ? {deprecated: true} : {}),
                ...(defaultValue !== undefined ? {default: defaultValue} : {}),
            };
        }
        if (schema.def.nullable) {
            base = {oneOf: [base, {type: 'null'}]};
        }
        return base;
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
