import {IPCServer} from "@grest-ts/ipc";
import type {ERROR_JSON} from "@grest-ts/schema";

export interface MockableCallPayload {
    className: string;
    methodName: string;
    callArgs: any;
}

export interface MockableSpyResultPayload {
    className: string;
    methodName: string;
    callResult?: any;
    /** What the spied call threw, instead of a result. */
    callError?: ERROR_JSON;
}

export const GGMockableIPC = {
    testServer: {
        call: IPCServer.defineRequest<MockableCallPayload, any>("mockable/call"),
        spyResult: IPCServer.defineRequest<MockableSpyResultPayload, any>("mockable/spy-result"),
    }
}
