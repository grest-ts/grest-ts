import type {GGSchema, GGSchemaDescription} from "@grest-ts/schema";
import type {GGOpenApiSchemaResolver} from "../schema/GGHttpSchema";
import type {OpenAPIV3_1} from "openapi-types";

/**
 * Build OpenAPI parameter objects for a route from the contract's input schema.
 *
 * Path parameters are taken from the path template (:id → {id}).
 * For GET/DELETE (no body), remaining input fields become query parameters.
 *
 * Uses schemaResolver (when provided) to emit $ref for named schemas instead
 * of always inlining. Falls back to schema.toJSONSchema() when absent.
 *
 * Operates on toCompilerDef().shape to get actual GGSchema instances per field,
 * so the resolver can determine $ref eligibility correctly via schema._base.
 *
 * Type-cast note: openapi-types@12 defines OpenAPIV3_1.ParameterObject as a
 * direct alias of OpenAPIV3.ParameterObject, whose `schema` field resolves to
 * V3 schema types (missing `type:"null"` as a valid NonArraySchemaObjectType).
 * The casts to ParameterObject["schema"] are the precise boundary of that
 * typedef limitation — runtime objects are fully valid OpenAPI 3.1 parameters.
 */
export function buildOpenApiParameters(
    pathTemplate: string,
    hasBody: boolean,
    inputSchema: GGSchema<unknown> | undefined,
    schemaResolver?: GGOpenApiSchemaResolver
): OpenAPIV3_1.ParameterObject[] {
    const pathParams = (pathTemplate.match(/:(\w+)/g) || []).map(m => m.slice(1));
    if (!inputSchema) return pathParams.map(name => buildPathParam(name, undefined, schemaResolver));

    // Use toSchemaDescription() to get GGSchemaDescription instances per field.
    // This gives us the format-agnostic tree without coupling to internal def structure.
    const desc = inputSchema.toSchemaDescription();
    if (desc.node.kind !== 'object') return pathParams.map(name => buildPathParam(name, undefined, schemaResolver));

    const properties = desc.node.properties;

    const params: OpenAPIV3_1.ParameterObject[] = pathParams.map(name =>
        buildPathParam(name, properties[name], schemaResolver)
    );

    if (!hasBody) {
        for (const [name, fieldDesc] of Object.entries(properties)) {
            if (pathParams.includes(name)) continue;
            const resolved = schemaResolver
                ? schemaResolver(fieldDesc.schema)
                : fieldDesc.schema.toJSONSchema();
            const {description, ...schemaWithoutDescription} = resolved as any;
            const isRequired = !fieldDesc.optional && (resolved as any).default === undefined;
            const param: OpenAPIV3_1.ParameterObject = {
                name,
                in: 'query' as const,
                required: isRequired,
                schema: schemaWithoutDescription as OpenAPIV3_1.ParameterObject["schema"]
            };
            if (description) param.description = description;
            params.push(param);
        }
    }
    return params;
}

function buildPathParam(
    name: string,
    fieldDesc: GGSchemaDescription | undefined,
    schemaResolver?: GGOpenApiSchemaResolver
): OpenAPIV3_1.ParameterObject {
    if (!fieldDesc) {
        // Path params are always non-empty — an empty segment cannot be routed.
        return {name, in: 'path' as const, required: true as const,
            schema: {type: 'string', minLength: 1} as OpenAPIV3_1.ParameterObject["schema"]};
    }
    const resolved = schemaResolver ? schemaResolver(fieldDesc.schema) : fieldDesc.schema.toJSONSchema();
    const {description, ...schemaWithoutDescription} = resolved as any;
    const param: OpenAPIV3_1.ParameterObject = {
        name,
        in: 'path' as const,
        required: true as const,
        schema: schemaWithoutDescription as OpenAPIV3_1.ParameterObject["schema"]
    };
    if (description) param.description = description;
    return param;
}
