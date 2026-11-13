import type {GGMockableInterceptor} from "./GGMockableInterceptor";
import {GGTestComponent} from "../testers/GGTestComponent";
import {GGTestRunner} from "../GGTestRunner";
import {GGMockableIPC, MockableCallPayload, MockableSpyResultPayload} from "./GGMockableIPC";
import {ERROR} from "@grest-ts/schema";

export const CALL_THROUGH = "__spyCallThrough|migo0am5g0htea";

export class GGMockableInterceptorsServer implements GGTestComponent {

    private readonly interceptors: Map<string, GGMockableInterceptor> = new Map();

    constructor(runner: GGTestRunner) {
        const server = runner.ipcServer;
        server.onFrameworkMessage(GGMockableIPC.testServer.call, body => this.call(body));
        server.onFrameworkMessage(GGMockableIPC.testServer.spyResult, body => this.spyResult(body));
    }

    /** Mock data for the call, or CALL_THROUGH when nothing mocks it (a spy, or no interceptor at all). */
    public async call(body: MockableCallPayload): Promise<any> {
        const handler = this.interceptors.get(body.className + "." + body.methodName);
        if (!handler) return CALL_THROUGH;

        // onRequest validates input and returns mock data (or undefined for spy)
        const result = await handler.onRequest(body.callArgs);
        if (handler.passThrough) return CALL_THROUGH;
        if (result instanceof Error) throw result;
        return result;
    }

    public async spyResult(body: MockableSpyResultPayload): Promise<void> {
        const handler = this.interceptors.get(body.className + "." + body.methodName);
        // A call through without a spy: nothing to check.
        if (!handler || !handler.passThrough) return;
        await handler.onResponse(body.callError ? ERROR.fromJson(body.callError) : body.callResult);
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
