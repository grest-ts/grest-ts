import type {GGSchema} from "@grest-ts/schema";
import type {OpenAPIV3_1} from "openapi-types";

/**
 * Build OpenAPI parameter objects for a route from the contract's input schema.
 *
 * Path parameters are taken from the path template (:id → {id}).
 * For GET/DELETE (no body), remaining input fields become query parameters.
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
    inputSchema: GGSchema<unknown> | undefined
): OpenAPIV3_1.ParameterObject[] {
    const pathParams = (pathTemplate.match(/:(\w+)/g) || []).map(m => m.slice(1));

    const objSchema = inputSchema
        ? inputSchema.toJSONSchema() as OpenAPIV3_1.NonArraySchemaObject
        : undefined;
    const shape = objSchema?.properties;
    const required = objSchema?.required;

    const params: OpenAPIV3_1.ParameterObject[] = pathParams.map(name => {
        const fieldSchema = shape?.[name] as OpenAPIV3_1.SchemaObject | undefined;
        const {description, ...schemaWithoutDescription} = (fieldSchema ?? {type: 'string'}) as any;
        const param: OpenAPIV3_1.ParameterObject = {
            name,
            in: 'path' as const,
            required: true as const,
            schema: schemaWithoutDescription as OpenAPIV3_1.ParameterObject["schema"]
        };
        if (description) param.description = description;
        return param;
    });

    if (!hasBody && shape) {
        for (const [name, fieldSchema] of Object.entries(shape)) {
            if (pathParams.includes(name)) continue;
            const fs = fieldSchema as OpenAPIV3_1.SchemaObject;
            const {description, ...schemaWithoutDescription} = fs as any;
            // A field with a default value is functionally optional: the server fills it in
            // when the client omits it. Don't mark it required even if the object schema does.
            const isRequired = (required?.includes(name) ?? false) && fs.default === undefined;
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
