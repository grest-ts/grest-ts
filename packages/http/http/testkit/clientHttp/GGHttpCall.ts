/**
 * Test action for HTTP API calls.
 *
 * Handles HTTP requests with proper test action lifecycle
 * (interceptors, expectations, logging).
 */

import {ERROR, GGErrorData, GGPromise, VALIDATION_ERROR, ValidationIssueJson} from "@grest-ts/schema";
import {GGTestAction, GGTestActionConfig, tActionRawData} from "@grest-ts/testkit";
import {ConstructorOf} from "@grest-ts/common";
import {parseContractResponse} from "../utils/validateContractResponse";
import {GGContext} from "@grest-ts/context";

export class GGHttpCall<InputData, SuccessData, ErrorsUnion extends ERROR<any, any>> extends GGTestAction<SuccessData> {

    private readonly data: any;
    private readonly _execute: (data: any) => GGPromise<any, any>;

    private _validatingError: ConstructorOf<ERROR<any, any>> | undefined;
    private _validatingContext: Partial<GGErrorData> | undefined;

    constructor(ctx: GGContext, methodName: string, data: any, execute: (data: any) => GGPromise<any, any>) {
        const config: GGTestActionConfig = {
            noResponse: false,
            logData: {
                message: "[HTTP " + methodName + "]",
                request: data
            }
        };
        super(ctx, config);
        this.data = data;
        this._execute = execute;
    }

    /** The call ends with this error; the matchers after it check the error's data. */
    public toBeError<Type extends ConstructorOf<ErrorsUnion>>(type: Type): GGHttpCall<InputData, ExtractBadRequestData<Type, ErrorsUnion, InputData>, never> {
        this._validatingError = type;
        this.responseExpectations.flush();
        return this as any;
    }

    /** After `.toBeError()`: matched like `toMatchObject` against the error's context, e.g. `{displayMessage: expect.stringContaining("…")}`. */
    public withContext(context: Partial<GGErrorData>): this {
        if (!this._validatingError) throw new Error(".withContext() checks the error's context: call .toBeError() first.");
        this._validatingContext = context;
        return this;
    }

    protected async executeAction(): Promise<tActionRawData> {
        return this._execute(this.data).asResult();
    }

    protected processRawResponse(result: tActionRawData): Promise<SuccessData> {
        return parseContractResponse(result, this._validatingError, this._validatingContext);
    }
}

export type ExtractBadRequestData<Type extends { new(...args: any[]): any }, Union, InputData = unknown> =
    Union extends InstanceType<Type>
        ? Union extends typeof VALIDATION_ERROR.infer
            ? ValidationErrorsObject<InputData>
            : Union extends ERROR<any, infer Data>
                ? Data
                : never
        : never;

export type ValidationFieldError = string[] & { __issue?: ValidationIssueJson }

export type ValidationErrorsObject<T> = T extends object
    ? { [K in keyof T]?: ValidationFieldError | { __issue?: ValidationIssueJson } }
    : { [key: string]: ValidationFieldError | { __issue?: ValidationIssueJson } }
