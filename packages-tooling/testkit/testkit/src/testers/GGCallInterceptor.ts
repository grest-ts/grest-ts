import type {GGTestRunner} from "../GGTestRunner";
import type {GGInterceptorTarget} from "./GGTestTarget";
import {GGLocator, GGLocatorScope} from "@grest-ts/locator";
import {GGExpectations} from "../utils/GGExpectations";
import {GGTestError} from "../utils/GGTestError";
import {GGLog} from "@grest-ts/logger";
import {ERROR} from "@grest-ts/schema";

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
    expectError?: any;
    /** Set by `.on()`: only calls that happen at this runtime or address. */
    target?: GGInterceptorTarget;
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
    public readonly target?: GGInterceptorTarget;

    private noOfTimesCalled = 0;
    private isRegistered = false;
    private scope!: GGLocatorScope;
    private readonly elsewhere = new Map<string, number>();
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
        this.target = config.target;
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

    /** Kinds that can tell where a call happens override this; it throws for a target they can't match. */
    protected checkTarget(_target: GGInterceptorTarget): void {
        throw new Error(`[${this.getKey()}] .on() is not supported for this kind of mock or spy. ` +
            "It works on HTTP schema mocks and spies (Api.mock.x / Api.spy.x) and on mockOf / spyOn.");
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
        if (this.target) this.checkTarget(this.target);
        // Callbacks run here, not in the router's scope, so they can use the test's clients.
        this.scope = GGLocator.getScope();

        const mode = this.passThrough ? "spy" : "mock";
        GGLog.debug(this, `Add ${mode} interceptor ${this.getLabel()}`);

        this.doRegister();
        this.isRegistered = true;
    }

    public unregister(): void {
        if (!this.isRegistered) {
            throw new Error("Interceptor is not registered, but trying to unregister. This should not happen...");
        }

        const mode = this.passThrough ? "spy" : "mock";
        GGLog.debug(this, `Remove ${mode} interceptor ${this.getLabel()}`);

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
                return await this.scope.run(() => this.returnData(transformed));
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
                context: this.getLabel(),
                test: this.noOfTimesCalled ? "Interceptor called too few times!" : "Interceptor was never called!",
                expected: this.expectedCalls(),
                received: `Called ${this.noOfTimesCalled} time(s)`,
                extra: this.elsewhere.size
                    ? "Calls to this method in this action went to: " + [...this.elsewhere].map(([where, count]) => `${where} (${count})`).join(", ")
                    : undefined,
                sourceFile: this.definedInSourceFile
            });
        }
    }

    public getMockValidationError(): Error | undefined {
        return this.validationError;
    }

    /** Done: called as often as expected, or a call failed its expectations. */
    public isCalled(): boolean {
        return this.noOfTimesCalled >= this.times.min || this.validationError !== undefined;
    }

    /** A call to this method could not be routed at all; the action fails with the reason. */
    public routingFailed(error: Error): void {
        this.setMockValidationError(new Error(error.message), "ROUTING_FAILED");
    }

    /** A call to this method was handled elsewhere (another runtime, another interceptor) while this one was active. */
    public wentElsewhere(where: string): void {
        this.elsewhere.set(where, (this.elsewhere.get(where) ?? 0) + 1);
    }

    public getLabel(): string {
        return this.target ? `[${this.getKey()} on ${this.target.label}]` : `[${this.getKey()}]`;
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
                context: this.getLabel(),
                test: "Interceptor called too many times!",
                expected: this.expectedCalls(),
                received: `Called ${this.noOfTimesCalled} times(s)`,
                sourceFile: this.definedInSourceFile
            });
        }
    }

    protected setMockValidationError(originalError: Error, type: string): void {
        const messagePrefix = `${this.getLabel()} ${type}`;
        GGLog.error(this, messagePrefix, originalError);

        (originalError as any).isMockValidationError = true;

        originalError.message = messagePrefix + "\n" + originalError.message;
        const lines = originalError.stack?.split("\n") || [];
        lines.shift();
        originalError.stack = lines.join("\n");
        this.validationError = originalError;
    }
}
