import {ERROR, OK, VALIDATION_ERROR} from "@grest-ts/schema";
import {GGLog} from "@grest-ts/logger";

/**
 * Parse contract response - unwrap OK/error structure and return inner data.
 * Used by HttpInterceptor, SocketInterceptor, and GGHttpCall.
 *
 * @returns The data to validate, or undefined if no data validation needed
 */
export function parseContractResponse(result: any, expectError: any): any {
    if (result instanceof ERROR) {
        if (expectError) {
            if (result.constructor.name !== expectError.name) {
                throw new Error(`Expected error '${expectError.name}', but got '${result.constructor.name}'`);
            }
            if (result instanceof VALIDATION_ERROR) {
                return toErrorsObject(result.data);
            }
            // For other error types, return the data if present
            const errorData = (result as ERROR<any, any>).data;
            if (errorData !== undefined) {
                return errorData;
            }
            return undefined;
        } else {
            GGLog.error("GGTest", result)
            throw new Error("Expected success 'OK', but got error '" + result.type + "'");
        }
    } else if (OK.isJson(result)) {
        if (expectError) {
            throw new Error("Expected error '" + expectError.name + "', but got success 'OK'");
        }
        return result.data;
    } else {
        throw new Error("Invalid contract response format: " + JSON.stringify(result));
    }
}

/**
 * Convert validation error array data to an errors object keyed by path.
 * Used primarily by VALIDATION_ERROR for test assertions.
 * Each field has an array of error messages plus __issue with the first issue's full data.
 */
function toErrorsObject(data: any): Record<string, string[] & { __issue?: { message: string; usedLanguage?: string; code?: string; params?: object } }> {
    if (!Array.isArray(data)) {
        return {}
    }
    const result: Record<string, string[] & { __issue?: { message: string; usedLanguage?: string; code?: string; params?: object } }> = {}
    for (const item of data) {
        if (typeof item === 'object' && item !== null && 'path' in item && 'message' in item) {
            const path = String(item.path)
            if (!result[path]) {
                const arr: string[] & { __issue?: { message: string; usedLanguage?: string; code?: string; params?: object } } = [] as any
                arr.__issue = {
                    message: String(item.message),
                    usedLanguage: (item as any).usedLanguage,
                    code: (item as any).code,
                    params: (item as any).params
                }
                result[path] = arr
            }
            result[path].push(String(item.message))
        }
    }
    return result
}
