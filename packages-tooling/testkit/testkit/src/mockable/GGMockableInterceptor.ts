import type {GGTestRunner} from "../GGTestRunner";
import {GGCallInterceptor, GGCallInterceptorConfig} from "../testers/GGCallInterceptor";
import {GGMockableInterceptorsServer} from "./GGMockableInterceptorsServer";
import {GGInterceptorTarget, GGTestTarget} from "../testers/GGTestTarget";
import {checkError} from "../utils/checkError";
import {ERROR} from "@grest-ts/schema";

export interface MockableInterceptorConfig extends GGCallInterceptorConfig {
    className: string;
    methodName: string;
}

/**
 * Interceptor for mocking/spying on mockable class methods.
 * Registers with GGMockableInterceptorsServer which handles the IPC communication.
 *
 * For spy mode, the flow is two-phase:
 * 1. mockable/call → onRequest() validates input, returns undefined (CALL_THROUGH)
 * 2. mockable/spy-result → onResponse() validates output
 */
export class GGMockableInterceptor extends GGCallInterceptor {

    public readonly className: string;
    public readonly methodName: string;

    constructor(test: GGTestRunner, config: MockableInterceptorConfig) {
        super(test, config);
        this.className = config.className;
        this.methodName = config.methodName;
    }

    public getKey(): string {
        return `${this.className}.${this.methodName}`;
    }

    protected checkTarget(target: GGInterceptorTarget): void {
        if (target instanceof GGTestTarget) {
            throw new Error(`[${this.getKey()}] .on() takes a runtime here, not an address: a method runs in a runtime, not at an address.`);
        }
    }

    protected doRegister(): void {
        this.test.getExtensionInstance(GGMockableInterceptorsServer).addInterceptor(this);
    }

    protected doUnregister(): void {
        this.test.getExtensionInstance(GGMockableInterceptorsServer).deleteInterceptor(this);
    }

    protected spyGetsResponses(): boolean {
        return true;
    }

    protected parseResponseData(result: any): any {
        if (result instanceof ERROR) {
            checkError(result, this.expectError, this.expectErrorContext);
            return result.data;
        }
        if (this.expectError) throw new Error(`Expected error '${this.expectError.name}', but the call returned`);
        return result;
    }
}
