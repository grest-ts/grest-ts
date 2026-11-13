import type {GGMockableInterceptor} from "./GGMockableInterceptor";
import {GGTestComponent} from "../testers/GGTestComponent";
import {GGTestRunner} from "../GGTestRunner";
import {GGMockableIPC, MockableCallPayload, MockableSpyResultPayload} from "./GGMockableIPC";
import {ERROR} from "@grest-ts/schema";
import type {MockableTestContext} from "@grest-ts/testkit-runtime";

export const CALL_THROUGH = "__spyCallThrough|migo0am5g0htea";

export class GGMockableInterceptorsServer implements GGTestComponent {

    private readonly interceptors: Map<string, GGMockableInterceptor> = new Map();

    /** For a @mockable call made in the test process, outside any runtime. */
    public readonly testProcessContext: MockableTestContext = {
        CALL_THROUGH,
        sendCall: (className, methodName, callArgs) => this.call({className, methodName, callArgs}),
        sendSpyResult: (className, methodName, callResult) => this.checkSpy(className, methodName, callResult),
        sendSpyError: (className, methodName, error) => this.checkSpy(className, methodName, ERROR.fromUnknown(error)),
    };

    constructor(runner: GGTestRunner) {
        const server = runner.ipcServer;
        server.onFrameworkMessage(GGMockableIPC.testServer.call, body => this.call(body));
        server.onFrameworkMessage(GGMockableIPC.testServer.spyResult, body => this.spyResult(body));
    }

    /** Mock data for the call, or CALL_THROUGH when nothing mocks it (a spy, or no interceptor at all). */
    private async call(body: MockableCallPayload): Promise<any> {
        const handler = this.interceptors.get(body.className + "." + body.methodName);
        if (!handler) return CALL_THROUGH;

        // onRequest validates input and returns mock data (or undefined for spy)
        const result = await handler.onRequest(body.callArgs);
        if (handler.passThrough) return CALL_THROUGH;
        if (result instanceof Error) throw result;
        return result;
    }

    private async spyResult(body: MockableSpyResultPayload): Promise<void> {
        await this.checkSpy(body.className, body.methodName, body.callError ? ERROR.fromJson(body.callError) : body.callResult);
    }

    private async checkSpy(className: string, methodName: string, result: unknown): Promise<void> {
        const handler = this.interceptors.get(className + "." + methodName);
        // A call through without a spy: nothing to check.
        if (!handler || !handler.passThrough) return;
        await handler.onResponse(result);
    }

    public addInterceptor(interceptor: GGMockableInterceptor) {
        this.interceptors.set(interceptor.getKey(), interceptor);
    }

    public deleteInterceptor(interceptor: GGMockableInterceptor) {
        this.interceptors.delete(interceptor.getKey());
    }

    public async teardown(): Promise<void> {
        this.interceptors.clear();
    }
}

GGTestRunner.registerExtension(GGMockableInterceptorsServer);
