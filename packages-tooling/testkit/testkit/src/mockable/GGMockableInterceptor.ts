import type {GGTestRunner} from "../GGTestRunner";
import {GGCallInterceptor, GGCallInterceptorConfig} from "../testers/GGCallInterceptor";
import {GGMockableInterceptorsServer} from "./GGMockableInterceptorsServer";

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

    protected doRegister(): void {
        this.test.getExtensionInstance(GGMockableInterceptorsServer).addInterceptor(this);
    }

    protected doUnregister(): void {
        this.test.getExtensionInstance(GGMockableInterceptorsServer).deleteInterceptor(this);
    }

    protected parseResponseData(result: any): any {
        return result;
    }
}
