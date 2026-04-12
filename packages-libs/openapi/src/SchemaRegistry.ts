import type {ANY_ERROR_CLS, GGSchema, GGSchemaDescription} from "@grest-ts/schema";
import type {OpenAPIV3_1} from "openapi-types";
import {schemaDescriptionToOpenApi} from "./schemaDescriptionToOpenApi";

/**
 * Registry that extracts named schemas into components/schemas and returns
 * $ref references to them.
 *
 * Uses GGSchemaDescription (the format-agnostic intermediate representation
 * produced by schema.toSchemaDescription()) to walk the schema tree without
 * any knowledge of the schema library's internal def structure.
 *
 * Extraction rules:
 *  - desc.canonical (the structural base schema) has a docs.title → extract
 *    to components/schemas, return $ref
 *  - nullable → wrap $ref in {oneOf: [$ref, {type:"null"}]}
 *  - field-level description that differs from base type → sibling alongside $ref
 *  - no title on canonical → build inline, recurse into children
 */
export class SchemaRegistry {
    private readonly components = new Map<string, OpenAPIV3_1.SchemaObject>();
    private readonly baseToName = new Map<GGSchema<any>, string>();
    private readonly building = new Set<GGSchema<any>>();

    schemaOrRef(schema: GGSchema<any>): OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject {
        return this.descOrRef(schema.toSchemaDescription());
    }

    descOrRef(desc: GGSchemaDescription): OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject {
        const base = desc.canonical ?? desc.schema;
        const title = base.def.docs?.title;

        if (title) {
            const name = toComponentName(title);

            if (!this.baseToName.has(base)) {
                this.baseToName.set(base, name);
                if (!this.building.has(base)) {
                    this.building.add(base);
                    const basDesc = base.toSchemaDescription();
                    this.components.set(name, this.buildFromDesc(basDesc));
                    this.building.delete(base);
                }
            }

            const ref: OpenAPIV3_1.ReferenceObject = {$ref: `#/components/schemas/${name}`};

            if (desc.nullable) {
                return {oneOf: [ref, {type: 'null'}]};
            }

            // Field-level description sibling (OpenAPI 3.1 allows keywords alongside $ref)
            const fieldDesc = desc.docs?.description;
            const baseDesc = base.def.docs?.description;
            if (fieldDesc && fieldDesc !== baseDesc) {
                return {...ref, description: fieldDesc} as OpenAPIV3_1.SchemaObject;
            }

            return ref;
        }

        return this.buildFromDesc(desc);
    }

    /**
     * Build an OpenAPIV3_1.SchemaObject from a GGSchemaDescription,
     * recursing into composite children via descOrRef().
     * Called only for schemas with no extractable component (no title on canonical).
     */
    private buildFromDesc(desc: GGSchemaDescription): OpenAPIV3_1.SchemaObject {
        const node = desc.node;
        let schema: OpenAPIV3_1.SchemaObject;

        switch (node.kind) {
            case 'object': {
                const properties: Record<string, OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject> = {};
                const required: string[] = [];
                for (const [key, child] of Object.entries(node.properties)) {
                    properties[key] = this.descOrRef(child);
                    if (!child.optional) required.push(key);
                }
                const s: OpenAPIV3_1.NonArraySchemaObject = {type: 'object', properties};
                if (required.length) s.required = required;
                schema = s;
                break;
            }
            case 'array': {
                const items = this.descOrRef(node.element);
                const s: OpenAPIV3_1.ArraySchemaObject = {type: 'array', items};
                if (node.minItems !== undefined) s.minItems = node.minItems;
                if (node.maxItems !== undefined) s.maxItems = node.maxItems;
                schema = s;
                break;
            }
            case 'union':
                schema = {oneOf: node.variants.map(v => this.descOrRef(v))};
                break;
            case 'discriminated':
                schema = {
                    oneOf: node.variants.map(v => this.descOrRef(v)),
                    discriminator: {propertyName: node.discriminator}
                };
                break;
            case 'tuple': {
                const prefixItems = node.elements.map(e => this.descOrRef(e));
                schema = {
                    type: 'array',
                    prefixItems,
                    minItems: node.elements.length,
                    maxItems: node.elements.length,
                    items: false,
                } as unknown as OpenAPIV3_1.ArraySchemaObject;
                break;
            }
            case 'record': {
                const additionalProperties = this.descOrRef(node.value);
                schema = {type: 'object', additionalProperties};
                break;
            }
            default:
                // Leaf types (string, number, boolean, literal, bit, any, unknown, file, password)
                return schemaDescriptionToOpenApi(desc);
        }

        return this.applyDocs(schema, desc);
    }

    private applyDocs(built: OpenAPIV3_1.SchemaObject, desc: GGSchemaDescription): OpenAPIV3_1.SchemaObject {
        const {docs, defaultValue, nullable} = desc;
        if (docs || defaultValue !== undefined) {
            built = {
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
        if (nullable) {
            built = {oneOf: [built, {type: 'null'}]};
        }
        return built;
    }

    /** Cache of error class identity → component name for full error body schemas. */
    private readonly errClsToName = new Map<ANY_ERROR_CLS, string>();

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
 */
export function errorComponentName(type: string): string {
    const pascal = type
        .split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('');
    return `Error_${pascal}`;
}
