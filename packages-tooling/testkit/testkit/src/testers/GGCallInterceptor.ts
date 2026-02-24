import type {GGTestRunner} from "../GGTestRunner";
import {GGExpectations} from "../utils/GGExpectations";
import {GGTestError} from "../utils/GGTestError";
import {GGLog} from "@grest-ts/logger";

import {IGGTestInterceptor} from "./IGGTestInterceptor";

/**
 * Configuration for creating an interceptor.
 * Used by both mock and spy modes - passThrough determines behavior.
 */
export interface GGCallInterceptorConfig {
    definedInSourceFile: string;
    sleep: number;
    times: number;
    passThrough: boolean;
    inputExpectations?: GGExpectations<any>;
    outputExpectations?: GGExpectations<any>;
    returnData?: any;
    expectError?: any;
}

/**
 * Unified base class for mock/spy interceptors.
 *
 * - Mock mode (passThrough=false): validates input, returns fake data
 * - Spy mode (passThrough=true): validates input, calls through, validates output
 *
 * Transport-specific subclasses provide register/unregister/getKey.
 */
export abstract class GGCallInterceptor implements IGGTestInterceptor {

    protected readonly test: GGTestRunner;
    private readonly definedInSourceFile: string;
    private readonly _sleep: number;
    private readonly times: number;
    public readonly passThrough: boolean;
    private readonly inputExpectations?: GGExpectations<any>;
    private readonly outputExpectations?: GGExpectations<any>;
    private readonly returnData?: any;

    private noOfTimesCalled = 0;
    private isRegistered = false;
    private validationError: Error | undefined;

    protected constructor(test: GGTestRunner, config: GGCallInterceptorConfig) {
        this.test = test;
        this.definedInSourceFile = config.definedInSourceFile;
        this._sleep = config.sleep;
        this.times = config.times;
        this.passThrough = config.passThrough;
        this.inputExpectations = config.inputExpectations;
        this.outputExpectations = config.outputExpectations;
        this.returnData = config.returnData;
        if (this.passThrough) {
            if (this.returnData !== undefined) {
                throw new Error("Spy can't have returnData! It calls through and returns what ever it receives!")
            }
        } else {
            if (this.outputExpectations) {
                throw new Error("Mocks can't have output expectations, they return the data that is defined in the test!")
            }
        }
    }

    // -------------------------------------------
    // Abstract - transport subclass provides
    // -------------------------------------------

    public abstract getKey(): string;

    protected abstract doRegister(): void;

    protected abstract doUnregister(): void;

    protected abstract parseResponseData(result: any): any;

    /**
     * Transform request body before checking expectations.
     * Override to extract/transform the input for validation.
     * Default: returns body unchanged.
     */
    protected transformInput(body: any): any {
        return body;
    }

    // -------------------------------------------
    // Registration lifecycle
    // -------------------------------------------

    public register(): void {
        if (this.isRegistered) {
            throw new Error("Interceptor already registered, this should not happen...");
        }
        if (this.noOfTimesCalled > 0) {
            throw new Error("Should not register interceptor multiple times. Something is wrong...");
        }
        this.isRegistered = true;

        const mode = this.passThrough ? "spy" : "mock";
        GGLog.debug(this, `Add ${mode} interceptor [${this.getKey()}]`);

        this.doRegister();
    }

    public unregister(): void {
        if (!this.isRegistered) {
            throw new Error("Interceptor is not registered, but trying to unregister. This should not happen...");
        }

        const mode = this.passThrough ? "spy" : "mock";
        GGLog.debug(this, `Remove ${mode} interceptor [${this.getKey()}]`);

        this.doUnregister();
        this.isRegistered = false;
    }

    // -------------------------------------------
    // Request/Response handling
    // -------------------------------------------

    /**
     * Handle incoming request.
     * - Validates input expectations
     * - For mock: returns configured returnData
     * - For spy: returns undefined (signal to pass through)
     */
    public async onRequest(body: any): Promise<any> {
        try {
            this.checkNoOfTimesCalled();
            const transformed = this.transformInput(body);
            this.inputExpectations?.check(transformed);
        } catch (error: any) {
            const errorType = this.passThrough ? "SPY_REQUEST_VALIDATION_FAILED" : "MOCK_VALIDATION_FAILED";
            this.setMockValidationError(error, errorType);
            throw error;
        }

        if (!this.passThrough) {
            await this.sleepIfNeeded();
            return this.returnData;
        }

        return undefined;
    }

    /**
     * Handle response (spy mode only).
     * Called after pass-through completes with the real response.
     * Parses response via transport-specific method, then validates.
     */
    public async onResponse(result: any): Promise<void> {
        if (!this.passThrough) {
            throw new Error("onResponse called in mock mode! Mocks don't have responses as they create fake responses! This is a coding error if you reach here!");
        }
        try {
            const data = this.parseResponseData(result);
            this.outputExpectations?.check(data);
            await this.sleepIfNeeded();
        } catch (error: any) {
            this.setMockValidationError(error, "SPY_RESPONSE_VALIDATION_FAILED");
            throw error;
        }
    }

    // -------------------------------------------
    // Validation after test completes
    // -------------------------------------------

    public validate(): void {
        if (this.noOfTimesCalled === 0 && this.times > 0) {
            throw new GGTestError({
                test: "Expected to be called, but was not.",
                expected: "To be called",
                received: "-",
                sourceFile: this.definedInSourceFile
            });
        }
    }

    public getMockValidationError(): Error | undefined {
        return this.validationError;
    }

    public isCalled(): boolean {
        return this.noOfTimesCalled > 0;
    }

    // -------------------------------------------
    // Helpers
    // -------------------------------------------

    protected async sleepIfNeeded(): Promise<void> {
        if (this._sleep) {
            await new Promise(resolve => setTimeout(resolve, this._sleep));
        }
    }

    protected checkNoOfTimesCalled(): void {
        this.noOfTimesCalled++;
        if (this.noOfTimesCalled > this.times) {
            throw new GGTestError({
                context: `[${this.getKey()}]`,
                test: "Interceptor called too many times!",
                expected: `Called ${this.times} time(s)`,
                received: `Called ${this.noOfTimesCalled} times(s)`,
                sourceFile: this.definedInSourceFile
            });
        }
    }

    protected setMockValidationError(originalError: Error, type: string): void {
        const messagePrefix = `[${this.getKey()}] ${type}`;
        GGLog.error(this, messagePrefix, originalError);

        (originalError as any).isMockValidationError = true;

        originalError.message = messagePrefix + "\n" + originalError.message;
        const lines = originalError.stack?.split("\n") || [];
        lines.shift();
        originalError.stack = lines.join("\n");
        this.validationError = originalError;
    }
}
