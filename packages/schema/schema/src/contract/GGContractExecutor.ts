import {ANY_ERROR, ANY_ERROR_CLS, ERROR, ERROR_JSON, SERVER_ERROR} from "./ERROR";
import {GGSchema} from "../GGSchema";
import {GGContractMethod} from "./GGContractClass";
import {EXISTS, FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND, ROUTE_NOT_FOUND, VALIDATION_ERROR} from "./standardErrors";
import {OK} from "./OK";
import {GGPromise} from "./GGPromise";

export class GGContractExecutor {

    private static readonly SYSTEM_ERRORS: Record<string, ANY_ERROR_CLS> = {
        [NOT_AUTHORIZED.TYPE]: NOT_AUTHORIZED,
        [FORBIDDEN.TYPE]: FORBIDDEN,
        [NOT_FOUND.TYPE]: NOT_FOUND,
        [ROUTE_NOT_FOUND.TYPE]: ROUTE_NOT_FOUND,
        [EXISTS.TYPE]: EXISTS,
        [VALIDATION_ERROR.TYPE]: VALIDATION_ERROR,
        [SERVER_ERROR.TYPE]: SERVER_ERROR
    };

    /**
     * Throws in case of validation error.
     */
    public static parseInput<RequestData>(
        schema: GGSchema<RequestData> | undefined,
        data: RequestData | unknown
    ): RequestData {
        if (schema) {
            const parsed = schema.safeParse(data, true)
            if (parsed.success === true) {
                return parsed.value
            } else {
                throw new VALIDATION_ERROR(parsed.issues.toJSON(), {displayMessage: "Invalid arguments"})
            }
        } else {
            return undefined; // if not input validator, we do not pass data through for security reasons.
        }
    }

    /**
     * throws if resolving schema is not possible (Meaning invalid response)
     */
    public static getResponseSchema<RequestData, ResponseData, ErrorsUnion extends ANY_ERROR_CLS>(
        contract: GGContractMethod<RequestData, ResponseData, ErrorsUnion>,
        rawResponse: { type: string }
    ): GGSchema<ResponseData | ErrorsUnion["schema"]> | undefined {

        const type: string = rawResponse?.type;
        if (type === "OK") {
            return contract.success

        } else if (type === SERVER_ERROR.TYPE) {
            return undefined;

        } else if (type === undefined) {
            throw new SERVER_ERROR({
                displayMessage: "Invalid response",
                debugMessage: "Tried to reply with invalid response data!",
                debugData: {
                    expected: "object",
                    received: typeof rawResponse,
                    response: rawResponse
                }
            })

        } else {
            // Check if error is listed in contract (system errors must also be listed)
            const errorCls = contract.errors?.find(e => e.TYPE === type);
            if (!errorCls) {
                // Error type not listed in contract
                throw new SERVER_ERROR({
                    displayMessage: "Invalid response",
                    debugMessage: "Tried to reply with not listed error code!",
                    debugData: {
                        expected: "One in: " + (contract.errors?.map(e => e.TYPE) || []),
                        received: type,
                        data: rawResponse
                    }
                })
            }
            return errorCls.schema
        }
    }

    /**
     * Validate response against a schema. Throws if validation fails.
     */
    public static parseOutputData<DataOrError, T extends any>(
        schema: GGSchema<DataOrError> | undefined,
        responseData: T,
    ): T {
        if (!schema) {
            return undefined;
        }
        const parsed = schema.safeParse(responseData, true)
        if (parsed.success === true) {
            return parsed.value as any
        } else {
            throw new SERVER_ERROR({
                displayMessage: "Invalid response",
                debugMessage: "Response validation failed!",
                debugData: parsed.issues
            })
        }
    }

    /**
     * Convert error response JSON to error class instance.
     */
    public static createErrorObj<Type extends string, Data>(result: ERROR_JSON<Type, Data>, customErrors?: ANY_ERROR_CLS[]): ERROR<Type, Data> | typeof SERVER_ERROR.infer {
        // Find custom error - support both array and object format
        const factory: ANY_ERROR_CLS = this.SYSTEM_ERRORS[result.type] ?? customErrors?.find(e => e.TYPE === result.type)
        if (factory) {
            let err: ERROR<Type, Data> | undefined;
            if (factory.schema) {
                err = new factory(result.data, result.context)
            } else {
                err = new factory(result.context)
            }
            err.stack = undefined;
            return err;
        } else {
            return new SERVER_ERROR({
                debugMessage: "Failed to create error from server error response!",
                debugData: {
                    unknownErrorType: result.type,
                    knownErrorTypes: customErrors?.map(e => e.TYPE).join(",") ?? "(none)",
                    response: result
                }
            });
        }
    }

    /**
     * Validate response against a schema. Throws if validation fails.
     */
    public static assertResponse<DataOrError>(
        schema: GGSchema<DataOrError> | undefined,
        rawResponse: OK<any> | ANY_ERROR,
    ): void {
        if (schema && !schema.is(rawResponse?.data)) {
            const parsed = schema.safeParse(rawResponse?.data, false)
            throw new SERVER_ERROR({
                displayMessage: "Invalid response",
                debugMessage: "Response validation failed!",
                debugData: parsed.success === true ? [] : parsed.issues
            })
        }
    }

    /**
     * Never throws, returns either response or error.
     * @deprecated Kind of deprecated, as contracts alone are not really used and wire codecs validate themselves.
     */
    public static async call<RequestData, ResponseData, ErrorsUnion extends ANY_ERROR_CLS>(
        contract: GGContractMethod<RequestData, ResponseData, ErrorsUnion>,
        data: RequestData | unknown,
        options: GGContractExecutorOptions | undefined,
        next: (data: RequestData) => void | Promise<ResponseData | ErrorsUnion["infer"]> | GGPromise<ResponseData, ErrorsUnion["infer"]>,
    ): Promise<OK<ResponseData> | ErrorsUnion["infer"]> {
        try {
            const noValidation = options?.noValidation === true;

            // Input validation
            const validatedBody = noValidation ? data : this.parseInput(contract.input, data)

            // Execution - normalize to plain mutable {success, type, data} object
            let resData: { success: boolean, type: string, data: any, context?: any };
            try {
                const handlerResult: any = await next(validatedBody as any);
                if (handlerResult instanceof ERROR) {
                    resData = handlerResult.toJSON();
                } else if (handlerResult?.success === false && typeof handlerResult?.type === "string") {
                    resData = handlerResult;
                } else if (handlerResult?.success === true && handlerResult?.type === "OK") {
                    resData = handlerResult;
                } else {
                    resData = {success: true, type: "OK", data: handlerResult};
                }
            } catch (error) {
                resData = (error instanceof ERROR ? error : ERROR.fromUnknown(error)).toJSON();
            }

            // Response handling
            if (!noValidation) {
                const schema = this.getResponseSchema(contract, resData);
                if (schema) {
                    resData.data = this.parseOutputData(schema, resData.data);
                } else if (resData.data !== undefined) {
                    resData.data = undefined;
                }
            }
            if (resData.success === true) {
                return resData as OK<ResponseData>;
            } else {
                return this.createErrorObj(resData as any, contract.errors);
            }
        } catch (error) {
            return ERROR.fromUnknown(error);
        }
    }

}

export interface GGContractExecutorOptions {
    /**
     * This flag is used in tests for example, so test would not locally validate errors, but actually call through.
     * Can also be useful if you want to disable validation in clients. Never use this on server side!
     */
    noValidation?: boolean
}

