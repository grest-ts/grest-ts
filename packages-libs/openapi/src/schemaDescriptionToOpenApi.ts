import type {GGSchema, GGSchemaDescription} from "@grest-ts/schema";
import type {OpenAPIV3_1} from "openapi-types";
import type {GGOpenApiSchemaResolver} from "@grest-ts/http";

/**
 * Convert a GGSchemaDescription to an OpenAPIV3_1.SchemaObject.
 *
 * This is the canonical JSON Schema / OpenAPI 3.1 converter for GGSchema types.
 * It lives in @grest-ts/openapi because JSON Schema is an OpenAPI-specific concern;
 * the schema library only produces format-agnostic GGSchemaDescription trees.
 *
 * @param desc  The description to convert
 * @param resolver  Optional resolver for child schemas. When provided, named schemas
 *   (those with a docs.title on their canonical) are emitted as $ref references.
 *   When absent (inlineSchemaResolver or omitted), all schemas are inlined.
 */
export function schemaDescriptionToOpenApi(
    desc: GGSchemaDescription,
    resolver?: GGOpenApiSchemaResolver
): OpenAPIV3_1.SchemaObject {
    const resolve = resolver ?? ((s: GGSchema<any>) => schemaDescriptionToOpenApi(s.toSchemaDescription()));

    const node = desc.node;
    let schema: OpenAPIV3_1.SchemaObject;

    switch (node.kind) {
        case 'string': {
            const s: OpenAPIV3_1.NonArraySchemaObject = {type: 'string'};
            if (node.minLength !== undefined) s.minLength = node.minLength;
            if (node.maxLength !== undefined) s.maxLength = node.maxLength;
            if (node.pattern) s.pattern = node.pattern;
            schema = s;
            break;
        }
        case 'number': {
            const s: OpenAPIV3_1.NonArraySchemaObject = {type: node.integer ? 'integer' : 'number'};
            if (node.min !== undefined) s.minimum = node.min;
            if (node.max !== undefined) s.maximum = node.max;
            if (node.multipleOf !== undefined) s.multipleOf = node.multipleOf;
            schema = s;
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
            const s: OpenAPIV3_1.SchemaObject = {enum: [...node.values]};
            if (types.size === 1) (s as OpenAPIV3_1.NonArraySchemaObject).type =
                types.values().next().value as OpenAPIV3_1.NonArraySchemaObjectType;
            schema = s;
            break;
        }
        case 'array': {
            const items = resolve(node.element.schema);
            const s: OpenAPIV3_1.ArraySchemaObject = {type: 'array', items};
            if (node.minItems !== undefined) s.minItems = node.minItems;
            if (node.maxItems !== undefined) s.maxItems = node.maxItems;
            schema = s;
            break;
        }
        case 'object': {
            const properties: Record<string, OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject> = {};
            const required: string[] = [];
            for (const [k, child] of Object.entries(node.properties)) {
                properties[k] = resolve(child.schema);
                if (!child.optional) required.push(k);
            }
            const s: OpenAPIV3_1.NonArraySchemaObject = {type: 'object', properties};
            if (required.length) s.required = required;
            schema = s;
            break;
        }
        case 'record':
            schema = {type: 'object', additionalProperties: resolve(node.value.schema)};
            break;
        case 'union':
            schema = {oneOf: node.variants.map(v => resolve(v.schema))};
            break;
        case 'discriminated':
            schema = {
                oneOf: node.variants.map(v => resolve(v.schema)),
                discriminator: {propertyName: node.discriminator}
            };
            break;
        case 'tuple': {
            const prefixItems = node.elements.map(e => resolve(e.schema));
            schema = {
                type: 'array',
                prefixItems,
                minItems: node.elements.length,
                maxItems: node.elements.length,
                items: false,
            } as unknown as OpenAPIV3_1.ArraySchemaObject;
            break;
        }
        case 'file': {
            const s: OpenAPIV3_1.NonArraySchemaObject = {type: 'string', format: 'binary'};
            if (node.accept?.length) s.description = `Accepted types: ${node.accept.join(', ')}`;
            schema = s;
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

/**
 * A schema resolver that always inlines — every schema is converted to its full
 * OpenAPI SchemaObject with no $ref extraction.
 *
 * Use this when you need a schema converted to OpenAPI format without a registry
 * (e.g. in unit tests for custom codecs, or when calling toOpenApiOperation()
 * outside of toOpenApi()).
 *
 * @example
 * codec.toOpenApiOperation({
 *     pathPrefix: "", methodName: "test", contract,
 *     schemaResolver: inlineSchemaResolver
 * })
 */
export const inlineSchemaResolver: GGOpenApiSchemaResolver =
    (schema: GGSchema<any>) => schemaDescriptionToOpenApi(schema.toSchemaDescription());
