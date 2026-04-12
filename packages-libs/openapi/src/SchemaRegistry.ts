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

    /**
     * Main entry point: resolve a GGSchemaDescription to a SchemaObject or ReferenceObject.
     * Named schemas (those whose canonical has a docs.title) are extracted to components/schemas.
     */
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
     * using schemaDescriptionToOpenApi with this registry's descOrRef as the resolver.
     * This eliminates duplicate switch logic — schemaDescriptionToOpenApi owns the conversion,
     * the registry owns only the $ref extraction decision.
     */
    private buildFromDesc(desc: GGSchemaDescription): OpenAPIV3_1.SchemaObject {
        return schemaDescriptionToOpenApi(desc, child => this.descOrRef(child));
    }

    /** Cache of error class identity → component name for full error body schemas. */
    private readonly errClsToName = new Map<ANY_ERROR_CLS, string>();

    errorBodyRef(errCls: ANY_ERROR_CLS): OpenAPIV3_1.ReferenceObject {
        if (!this.errClsToName.has(errCls)) {
            const name = errorComponentName(errCls.TYPE);
            this.errClsToName.set(errCls, name);

            const dataSchemaOrRef: OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject | undefined =
                errCls.schema != null ? this.descOrRef((errCls.schema as GGSchema<any>).toSchemaDescription()) : undefined;

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
