import type {GGContractMethod} from "@grest-ts/schema";
import type {OpenAPIV3_1} from "openapi-types";

/**
 * Builds the standard GGRpc JSON-envelope success response for OpenAPI.
 *
 * On-wire the response is always:
 *   { success: true, type: "OK", data: <success schema> }   (200)
 *   or no body                                               (204 when no success schema)
 *
 * Used by GGRpc.* and GGFileUpload codecs — both share the same JSON wire format
 * for their success response. Call this explicitly from toOpenApiOperation() so
 * the response shape is always declared, never silently assumed.
 */
export function buildRpcSuccessResponses(contract: GGContractMethod): OpenAPIV3_1.ResponsesObject {
    if (contract.success) {
        const successSchema: OpenAPIV3_1.NonArraySchemaObject = {
            type: "object",
            properties: {
                success: {type: "boolean", enum: [true]},
                type: {type: "string", enum: ["OK"]},
                data: contract.success.toJSONSchema()
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
