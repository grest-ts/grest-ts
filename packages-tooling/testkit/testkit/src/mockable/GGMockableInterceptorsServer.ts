import type {GGMockableInterceptor} from "./GGMockableInterceptor";
import {GGTestComponent} from "../testers/GGTestComponent";
import {GGInterceptorTable} from "../testers/GGInterceptorTable";
import {GGTestRunner} from "../GGTestRunner";
import {GGMockableIPC} from "./GGMockableIPC";

export const CALL_THROUGH = "__spyCallThrough|migo0am5g0htea";

export class GGMockableInterceptorsServer implements GGTestComponent {

    private readonly interceptors = new GGInterceptorTable<GGMockableInterceptor>();

    constructor(runner: GGTestRunner) {
        const server = runner.ipcServer;
        const runtimeOf = (runtimeId: string | undefined) => runtimeId === undefined ? undefined : runner.getRuntimeById(runtimeId);

        server.onFrameworkMessage(GGMockableIPC.testServer.call, async (body, msg) => {
            const runtime = runtimeOf(msg.runtimeId);
            const handler = this.interceptors.match(body.className + "." + body.methodName, runtime, runtime?.label ?? "an unknown runtime");
            // Unmocked @mockable methods run for real.
            if (!handler) return CALL_THROUGH;

            const result = await handler.onRequest(body.callArgs);

            if (handler.passThrough) {
                return CALL_THROUGH;
            } else if (result instanceof Error) {
                throw result;
            } else {
                return result;
            }
        });

        server.onFrameworkMessage(GGMockableIPC.testServer.spyResult, async (body, msg) => {
            const handler = this.interceptors.match(body.className + "." + body.methodName, runtimeOf(msg.runtimeId));
            if (handler?.passThrough) await handler.onResponse(body.callResult);
        });
    }

    public addInterceptor(interceptor: GGMockableInterceptor) {
        this.interceptors.add(interceptor);
    }

    public deleteInterceptor(interceptor: GGMockableInterceptor) {
        this.interceptors.delete(interceptor);
    }

    public async teardown(): Promise<void> {
        this.interceptors.clear();
    }
}

GGTestRunner.registerExtension(GGMockableInterceptorsServer);
