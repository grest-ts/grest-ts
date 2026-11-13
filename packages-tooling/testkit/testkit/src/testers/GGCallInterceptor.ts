import type {GGTestRunner} from "../GGTestRunner";
import {GGExpectations} from "../utils/GGExpectations";
import {GGTestError} from "../utils/GGTestError";
import {GGLog} from "@grest-ts/logger";
import {ERROR, GGErrorData} from "@grest-ts/schema";
import {ConstructorOf} from "@grest-ts/common";

import {IGGTestInterceptor} from "./IGGTestInterceptor";

/** How many calls an interceptor expects, both bounds inclusive. */
export interface GGCallTimes {
    min: number;
    max: number;
}

/**
 * Configuration for creating an interceptor.
 * Used by both mock and spy modes - passThrough determines behavior.
 */
export interface GGCallInterceptorConfig {
    definedInSourceFile: string;
    sleep: number;
    times: GGCallTimes;
    passThrough: boolean;
    inputExpectations?: GGExpectations<any>;
    outputExpectations?: GGExpectations<any>;
    returnData?: any;
    expectError?: ConstructorOf<ERROR<any, any>>;
    expectErrorContext?: Partial<GGErrorData>;
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
    private readonly times: GGCallTimes;
    public readonly passThrough: boolean;
    private readonly inputExpectations?: GGExpectations<any>;
    private readonly outputExpectations?: GGExpectations<any>;
    private readonly returnData?: any;
    protected readonly expectError?: ConstructorOf<ERROR<any, any>>;
    protected readonly expectErrorContext?: Partial<GGErrorData>;

    private noOfTimesCalled = 0;
    private noOfResponses = 0;
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
        this.expectError = config.expectError;
        this.expectErrorContext = config.expectErrorContext;
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

    /** Whether this transport calls onResponse for every spied call, so `.waitFor()` can wait for the response. */
    protected spyGetsResponses(): boolean {
        return false;
    }

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
        let transformed: any;
        try {
            this.checkNoOfTimesCalled();
            transformed = this.transformInput(body);
            this.inputExpectations?.check(transformed);
        } catch (error: any) {
            const errorType = this.passThrough ? "SPY_REQUEST_VALIDATION_FAILED" : "MOCK_VALIDATION_FAILED";
            this.setMockValidationError(error, errorType);
            throw error;
        }

        if (!this.passThrough) {
            await this.sleepIfNeeded();
            if (typeof this.returnData !== "function") return this.returnData;
            try {
                return await this.returnData(transformed);
            } catch (error) {
                if (error instanceof ERROR) return error;
                throw error;
            }
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
            this.noOfResponses++;
        } catch (error: any) {
            this.setMockValidationError(error, "SPY_RESPONSE_VALIDATION_FAILED");
            throw error;
        }
    }

    // -------------------------------------------
    // Validation after test completes
    // -------------------------------------------

    public validate(): void {
        if (this.noOfTimesCalled < this.times.min) {
            throw new GGTestError({
                context: `[${this.getKey()}]`,
                test: this.noOfTimesCalled ? "Interceptor called too few times!" : "Interceptor was never called!",
                expected: this.expectedCalls(),
                received: `Called ${this.noOfTimesCalled} time(s)`,
                sourceFile: this.definedInSourceFile
            });
        }
    }

    public getMockValidationError(): Error | undefined {
        return this.validationError;
    }

    /** Done: called (a spy that gets responses: responded) as often as expected, or a call failed its expectations. */
    public isCalled(): boolean {
        if (this.times.min === 0) {
            throw new GGTestError({
                context: `[${this.getKey()}]`,
                test: ".waitFor() has nothing to wait for: .anyTimes() is met by no call at all.",
                expected: "Use .times(n) to wait for n calls, or .with() to allow any number while the action runs",
                received: ".anyTimes()",
                sourceFile: this.definedInSourceFile
            });
        }
        const done = this.passThrough && this.spyGetsResponses() ? this.noOfResponses : this.noOfTimesCalled;
        return done >= this.times.min || this.validationError !== undefined;
    }

    // -------------------------------------------
    // Helpers
    // -------------------------------------------

    private expectedCalls(): string {
        const {min, max} = this.times;
        return min === max ? `Called ${min} time(s)` : max === Infinity ? `Called at least ${min} time(s)` : `Called ${min}-${max} time(s)`;
    }

    protected async sleepIfNeeded(): Promise<void> {
        if (this._sleep) {
            await new Promise(resolve => setTimeout(resolve, this._sleep));
        }
    }

    protected checkNoOfTimesCalled(): void {
        this.noOfTimesCalled++;
        if (this.noOfTimesCalled > this.times.max) {
            throw new GGTestError({
                context: `[${this.getKey()}]`,
                test: "Interceptor called too many times!",
                expected: this.expectedCalls(),
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
