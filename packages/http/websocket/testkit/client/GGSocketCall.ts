/**
 * Test action for WebSocket calls.
 *
 * Handles client-to-server WebSocket messages with proper test action
 * lifecycle (interceptors, expectations, logging).
 */

import {ERROR, VALIDATION_ERROR, ValidationIssueJson} from "@grest-ts/schema";
import {GGTestAction, GGTestActionConfig, tActionRawData} from "@grest-ts/testkit";
import {ConstructorOf} from "@grest-ts/common";
import {parseContractResponse} from "@grest-ts/http/testkit";
import {GGSocket} from "../../src/socket/GGSocket";
import {GGContext} from "@grest-ts/context";

export class GGSocketCall<InputData, SuccessData, ErrorsUnion extends ERROR<any, any>> extends GGTestAction<SuccessData> {

    private readonly socket: GGSocket;
    private readonly path: string;
    private readonly request: any;
    private readonly hasResponse: boolean;

    private _validatingError: ConstructorOf<ERROR<any, any>>;

    constructor(socket: GGSocket, path: string, request: any, hasResponse: boolean = true) {
        const config: GGTestActionConfig = {
            noResponse: !hasResponse,
            logData: {
                message: "[WS " + path + "]",
                request: request
            }
        };
        // Socket context works differently. The socket itself already runs in a context when it connected.
        // Individual calls can't update context - it's bound at connection time.
        super(new GGContext("SocketCall"), config);

        this.socket = socket;
        this.path = path;
        this.request = request;
        this.hasResponse = hasResponse;
    }

    public toBeError<Type extends ConstructorOf<ErrorsUnion>>(type: Type): GGSocketCall<InputData, ExtractSocketErrorData<Type, ErrorsUnion, InputData>, never> {
        this._validatingError = type;
        this.responseExpectations.flush();
        return this as any;
    }

    protected async executeAction(): Promise<tActionRawData> {
        return this.socket.send(this.path, this.request, this.hasResponse);
    }

    protected processRawResponse(result: tActionRawData): Promise<SuccessData> {
        return parseContractResponse(result, this._validatingError);
    }
}

export type ExtractSocketErrorData<Type extends { new(...args: any[]): any }, Union, InputData = unknown> =
    Union extends InstanceType<Type>
        ? Union extends typeof VALIDATION_ERROR.infer
            ? SocketValidationErrorsObject<InputData>
            : Union extends ERROR<any, infer Data>
                ? Data
                : never
        : never;

export type SocketValidationFieldError = string[] & { __issue?: ValidationIssueJson }

export type SocketValidationErrorsObject<T> = T extends object
    ? { [K in keyof T]?: SocketValidationFieldError | { __issue?: ValidationIssueJson } }
    : { [key: string]: SocketValidationFieldError | { __issue?: ValidationIssueJson } }
