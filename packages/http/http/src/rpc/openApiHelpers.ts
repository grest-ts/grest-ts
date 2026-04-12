import type {GGSchema} from "@grest-ts/schema";
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

    // Use toCompilerDef() to get the actual shape with GGSchema instances per field.
    // This is needed so schemaResolver can inspect _base for $ref eligibility.
    const def = inputSchema.toCompilerDef() as any;
    const shape = def.shape as Record<string, GGSchema<any>> | undefined;
    const required = def.shape
        ? Object.keys(def.shape).filter(k => !(def.shape[k] as GGSchema<any>).def.optional)
        : undefined;

    const params: OpenAPIV3_1.ParameterObject[] = pathParams.map(name =>
        buildPathParam(name, shape?.[name], schemaResolver)
    );

    if (!hasBody && shape) {
        for (const [name, fieldSchema] of Object.entries(shape)) {
            if (pathParams.includes(name)) continue;
            const resolved = schemaResolver
                ? schemaResolver(fieldSchema)
                : fieldSchema.toJSONSchema();
            const {description, ...schemaWithoutDescription} = resolved as any;
            const isRequired = (required?.includes(name) ?? false) && (resolved as any).default === undefined;
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
    fieldSchema: GGSchema<any> | undefined,
    schemaResolver?: GGOpenApiSchemaResolver
): OpenAPIV3_1.ParameterObject {
    if (!fieldSchema) {
        // Path params are always non-empty — an empty segment cannot be routed.
        return {name, in: 'path' as const, required: true as const,
            schema: {type: 'string', minLength: 1} as OpenAPIV3_1.ParameterObject["schema"]};
    }
    const resolved = schemaResolver ? schemaResolver(fieldSchema) : fieldSchema.toJSONSchema();
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
