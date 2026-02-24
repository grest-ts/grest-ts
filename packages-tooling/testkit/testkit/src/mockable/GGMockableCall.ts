import {GG_TEST_RUNTIME_WORKER} from "../GGTestRuntimeWorker";
import {CALL_THROUGH} from "./GGMockableInterceptorsServer";
import {GGMockableIPC} from "./GGMockableIPC";

const MOCKABLE_WRAPPED = Symbol('GGMockableWrapped');

export function GGMockableCall(cls: any, methodName: string, nameMapping: string[]): void {
    // Skip if already wrapped (happens in INLINE mode with multiple runtime instances)
    if (cls.prototype[methodName]?.[MOCKABLE_WRAPPED]) {
        return;
    }

    const originalMethod = cls.prototype[methodName];
    const wrappedMethod = async function (this: any, ...inputArgs: any[]) {
        const worker = GG_TEST_RUNTIME_WORKER.get();

        const args: any = {}
        for (let i = 0; i < inputArgs.length; i++) {
            if (!nameMapping[i]) break;
            args[nameMapping[i]] = inputArgs[i];
        }

        const result = await worker.ipcClient.sendFrameworkRequest(GGMockableIPC.testServer.call, {
            className: cls.name,
            methodName: methodName,
            callArgs: args
        });

        if (result === CALL_THROUGH) {
            const realResult = await originalMethod.apply(this, inputArgs);
            await worker.ipcClient.sendFrameworkRequest(GGMockableIPC.testServer.spyResult, {
                className: cls.name,
                methodName: methodName,
                callResult: realResult
            });
            return realResult;
        } else {
            return result;
        }
    };

    // Mark as wrapped and assign to prototype
    (wrappedMethod as any)[MOCKABLE_WRAPPED] = true;
    cls.prototype[methodName] = wrappedMethod;
}
