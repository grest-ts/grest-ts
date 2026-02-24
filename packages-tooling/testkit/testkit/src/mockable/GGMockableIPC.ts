import {IPCServer} from "@grest-ts/ipc";

export interface MockableCallPayload {
    className: string;
    methodName: string;
    callArgs: any;
}

export interface MockableSpyResultPayload {
    className: string;
    methodName: string;
    callResult: any;
}

export const GGMockableIPC = {
    testServer: {
        call: IPCServer.defineRequest<MockableCallPayload, any>("mockable/call"),
        spyResult: IPCServer.defineRequest<MockableSpyResultPayload, any>("mockable/spy-result"),
    }
}
