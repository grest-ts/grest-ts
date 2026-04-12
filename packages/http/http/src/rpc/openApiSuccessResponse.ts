import type {GGContractMethod} from "@grest-ts/schema";
import type {OpenAPIV3_1} from "openapi-types";
import type {GGOpenApiSchemaResolver} from "../schema/GGHttpSchema";

/**
 * Builds the standard GGRpc JSON-envelope success response for OpenAPI.
 *
 * On-wire the response is always:
 *   { success: true, type: "OK", data: <success schema> }   (200)
 *   or no body                                               (204 when no success schema)
 *
 * The resolver is used to emit $ref for named success schemas rather than
 * inlining them. Pass config.schemaResolver from toOpenApiOperation().
 */
export function buildRpcSuccessResponses(
    contract: GGContractMethod,
    resolver: GGOpenApiSchemaResolver
): OpenAPIV3_1.ResponsesObject {
    if (contract.success) {
        const dataSchema = resolver(contract.success);
        const successSchema: OpenAPIV3_1.NonArraySchemaObject = {
            type: "object",
            properties: {
                success: {type: "boolean", enum: [true]},
                type: {type: "string", enum: ["OK"]},
                data: dataSchema
            },
            required: ["success", "type", "data"]
        };
        return {
            "200": {
                description: "Success",
                content: {"application/json": {schema: successSchema}}
            }
        };
    }
    return {"204": {description: "No content"}};
}
