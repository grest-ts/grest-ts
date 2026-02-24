import type {GGMockableInterceptor} from "./GGMockableInterceptor";
import {GGTestComponent} from "../testers/GGTestComponent";
import {GGTestRunner} from "../GGTestRunner";
import {GGMockableIPC} from "./GGMockableIPC";

export const CALL_THROUGH = "__spyCallThrough|migo0am5g0htea";

export class GGMockableInterceptorsServer implements GGTestComponent {

    private readonly interceptors: Map<string, GGMockableInterceptor> = new Map();

    constructor(runner: GGTestRunner) {
        const server = runner.ipcServer;
        server.onFrameworkMessage(GGMockableIPC.testServer.call, async (body) => {
            const key = body.className + "." + body.methodName;
            const handler = this.interceptors.get(key);

            if (!handler) {
                // No mock configured - call through to real implementation
                // This allows testable() to invoke real methods on @mockable services
                // throw new Error(
                //     `Expected handler to be set for mockable '${key}'!\n` +
                //     "Did you forget to call .with(...)?"
                // );
                return CALL_THROUGH;
            }

            // onRequest validates input and returns mock data (or undefined for spy)
            const result = await handler.onRequest(body.callArgs);

            if (handler.passThrough) {
                // Spy mode - signal worker to call through
                return CALL_THROUGH;
            } else {
                // Mock mode - return the mock data
                return result;
            }
        });

        server.onFrameworkMessage(GGMockableIPC.testServer.spyResult, async (body) => {
            const key = body.className + "." + body.methodName;
            const handler = this.interceptors.get(key);

            if (!handler || !handler.passThrough) {
                // No spy handler configured - just ignore the result
                // This allows testable() to call through without requiring spyOn()
                // throw new Error(`Expected spy handler for '${key}'`);
                return;
            }

            // Validate the response from the real implementation
            await handler.onResponse(body.callResult);
        });
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
